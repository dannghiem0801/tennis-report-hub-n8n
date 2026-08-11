import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction, type ReactNode } from "react";
import type {
  BatchEntryResult,
  BatchSummary,
  Match,
  Report,
  ReportTemplate,
  ScheduledBatch,
  Settings,
  Sport,
  TennisMatch,
  Tournament,
  WatchlistEntry,
  WatchlistStatus,
} from "@/types";
import { storage } from "./persistence";
import {
  DEFAULT_TEMPLATES_BY_SPORT,
  migrateBundledTemplates,
} from "@/reports/templates";
import { migrateLLMConfig } from "@/api/llm";
import { generateReport, getMatchWinner, getFinalScore } from "@/reports/generate";
import { formatDateKey, formatTime, parseDateKey, uid, APP_TIMEZONE } from "@/lib/utils";
import {
  clearApiCache,
  getMatchesByDate,
  getMatchDetails,
  getPointByPoint,
  FlashscoreApiError,
  setRateLimitedListener,
} from "@/api/flashscore";
import { mapMatchesBatch, mapMatchDetails, mapPointByPoint } from "@/api/flashscore-mapper";

/**
 * Map `Sport` (UI enum) to the upstream `sportId` (RapidAPI flashscore4).
 * Source: `/get-sports` endpoint, verified at code time.
 * - 1 = Football
 * - 2 = Tennis
 * - 3 = Basketball (deferred — UI hides this tab)
 */
const SPORT_ID_MAP: Record<Sport, number> = {
  tennis: 2,
  football: 1,
  basketball: 3,
};

interface AppState {
  // data
  /** Sport currently selected on the TopBar. Drives all filtering
   *  (watchlist, reports, templates, scheduled batches) and the
   *  sportId passed to the API. Persisted in localStorage. */
  activeSport: Sport;
  selectedDate: string; // YYYY-MM-DD
  matches: Match[];
  tournaments: Tournament[]; // populated when using real API; empty for sample data
  isFetchingMatches: boolean;
  matchError: string | null;
  lastFetchedAt: Date | null;
  isUsingLiveData: boolean; // true when matches came from the live API, false for sample data
  rateLimitUntil: Date | null; // when set, refresh + polling are blocked until this time
  cacheSize: number; // count of cached API entries (for settings UI)
  /** True when the current `selectedDate` was auto-picked (smart fallback) —
   *  not the date the user explicitly asked for. Used to show a banner. */
  isDateAutoPicked: boolean;

  // user data
  watchlist: WatchlistEntry[];
  reports: Report[];
  templates: ReportTemplate[];
  settings: Settings;
  seenReportIds: string[];
  /** User-created scheduled batches (ADR 0001 — safety-net deadline
   *  force-writes for completed matches). Phase 3 wires the UI. */
  scheduledBatches: ScheduledBatch[];

  // derived
  isWatchlisted: (matchId: string) => boolean;
  getReportByMatch: (matchId: string) => Report | undefined;

  // actions
  setSelectedDate: (key: string) => void;
  /** Switch the active sport. Persists to localStorage, triggers a
   *  refetch of the dashboard for the new sport, and reloads the
   *  per-sport watchlist / reports / templates / scheduled batches. */
  setActiveSport: (sport: Sport) => void;
  refreshMatches: () => Promise<void>;
  toggleWatchlist: (match: Match) => void;
  /** Explicit add (idempotent). Returns the entry id, or null if the
   *  match was not found. Used by the schedule modal. */
  addToWatchlist: (match: Match) => string | null;
  removeFromWatchlist: (entryId: string) => void;
  markReportSeen: (reportId: string) => void;
  updateReport: (reportId: string, patch: Partial<Report>) => void;
  /** Mark a needs-review report as reviewed. No-op for legacy
   *  reports without `quality` so they keep their existing copy
   *  behavior. */
  acknowledgeReport: (reportId: string) => void;
  addTemplate: (t: Omit<ReportTemplate, "id">) => void;
  updateTemplate: (id: string, patch: Partial<ReportTemplate>) => void;
  deleteTemplate: (id: string) => void;
  setDefaultTemplate: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  dismissMatchError: () => void;
  /** Test the server-side RapidAPI configuration with today's fixtures.
   *  Returns null on success, or an error message string. */
  testApiConnection: () => Promise<string | null>;
  /** Clear cached API responses (fixtures + tournament info). Use when
   *  switching keys or troubleshooting stale data. */
  clearApiCacheAndRefresh: () => void;
  /** Delete all reports + reset the "Mới" badge state. Watchlist
   *  entries are preserved — they will re-trigger generation for any
   *  matches that are still completed. */
  clearAllReports: () => void;
  /** True if we're currently blocked from calling the API due to a 429. */
  isRateLimited: boolean;
  /** When the user-selected date has 0 matches, search backwards day-by-day
   *  and switch to the first date with matches. Returns the auto-picked date
   *  (YYYY-MM-DD) or null if nothing found in the last `maxDaysBack` days. */
  findNearbyDateWithMatches: (maxDaysBack?: number) => Promise<string | null>;
  /** Reset the auto-pick banner (e.g. when the user manually picks a date). */
  clearAutoPick: () => void;
  /** Date the user actually asked for (vs the auto-picked one we're showing). */
  userSelectedDate: string;

  // Scheduled batches (ADR 0001)
  addScheduledBatch: (
    batch: Omit<ScheduledBatch, "id" | "createdAt" | "status" | "completedAt" | "summary">
  ) => string;
  updateScheduledBatch: (id: string, patch: Partial<ScheduledBatch>) => void;
  /** Cancel a batch before fireAt. If already running, no-op (run finishes). */
  cancelScheduledBatch: (id: string) => void;
  /** Delete a batch and clear its `batchId` from any watchlist entries. */
  removeScheduledBatch: (id: string) => void;
  /** True if a ScheduledBatch is currently in "running" state (corner widget gate). */
  hasRunningBatch: boolean;
}

const AppContext = createContext<AppState | null>(null);

/**
 * Fire-and-forget helper: fetch BOTH per-set details AND point-by-point
 * for a watchlist match, in parallel, then patch matches state with
 * whichever data succeeded. Used by addToWatchlist, the
 * live→completed effect, and the report-generation pipeline.
 *
 * Two endpoints are involved:
 *   - /matches/details         → sets[] (per-set games) + stats
 *   - /matches/.../point-by-point → game-by-game breakdown
 *
 * We fetch both in parallel because they're independent and the user
 * typically wants both for a watchlist match. The cache layer in
 * flashscore.ts dedupes concurrent calls to the same key.
 *
 * - Dedupes via `requestedRef` (in-session, one entry per match ID).
 * - 7-day cache for both endpoints (across sessions).
 * - Partial success is OK: if details fails but PBP succeeds, we still
 *   patch the PBP. The match just shows PBP without per-set games.
 * - Silent fail on both: logs a warning and removes the match from the
 *   requested set so a future remount can retry.
 */
async function fetchAndCacheMatchData(
  matchId: string,
  requestedRef: MutableRefObject<Set<string>>,
  setMatches: Dispatch<SetStateAction<Match[]>>,
): Promise<{ sets?: TennisMatch["sets"]; pointByPoint?: TennisMatch["pointByPoint"]; stats?: TennisMatch["stats"] }> {
  // Fire both calls in parallel. allSettled guarantees we get both
  // outcomes even if one rejects.
  const [detailsResult, pbpResult] = await Promise.allSettled([
    getMatchDetails({ matchId }).then(mapMatchDetails),
    getPointByPoint({ matchId }).then(mapPointByPoint),
  ]);

  const details = detailsResult.status === "fulfilled" ? detailsResult.value : null;
  const pbp = pbpResult.status === "fulfilled" ? pbpResult.value : null;

  if (detailsResult.status === "rejected") {
    // eslint-disable-next-line no-console
    console.warn(`[details] Failed to fetch ${matchId}:`, detailsResult.reason);
  }
  if (pbpResult.status === "rejected") {
    requestedRef.current.delete(matchId);
    // eslint-disable-next-line no-console
    console.warn(`[pbp] Failed to fetch ${matchId}:`, pbpResult.reason);
  }

  // Patch only the fields that succeeded.
  const patch: Partial<TennisMatch> = {};
  if (details?.sets && details.sets.length > 0) patch.sets = details.sets;
  if (details?.stats) patch.stats = details.stats;
  if (pbp && pbp.sets.length > 0) patch.pointByPoint = pbp;

  if (Object.keys(patch).length > 0) {
    setMatches((current) =>
      current.map((m) => (m.id === matchId ? ({ ...m, ...patch } as Match) : m))
    );
  }

  return { sets: patch.sets, pointByPoint: patch.pointByPoint, stats: patch.stats };
}

export function AppProvider({ children }: { children: ReactNode }) {
  // Active sport (single key, persisted). Initial value from localStorage.
  const [activeSport, setActiveSportInternal] = useState<Sport>(() => storage.getActiveSport());

  // user data — per-sport (templates) and unified (everything else).
  //
  // Per ADR 0003, watchlist / reports / scheduled batches are unified
  // across all sports and do NOT swap on active-sport change. The
  // unified storage methods aggregate per-sport localStorage keys so
  // existing data is preserved (no migration needed). Only templates
  // remain per-sport (they encode sport-specific prompt structure)
  // and the dashboard match list.
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>(() => storage.getUnifiedWatchlist());
  const [reports, setReports] = useState<Report[]>(() => storage.getUnifiedReports());
  const [templates, setTemplates] = useState<ReportTemplate[]>(() => {
    const saved = storage.getTemplates(activeSport);
    if (saved.length > 0) {
      // Migrate any stale bundled copies (e.g. older tpl-prompt) to the
      // current bundled content. User-created templates are preserved.
      const migrated = migrateBundledTemplates(saved);
      if (migrated !== saved) storage.setTemplates(activeSport, migrated);
      return migrated;
    }
    const bundled = DEFAULT_TEMPLATES_BY_SPORT[activeSport] ?? [];
    storage.setTemplates(activeSport, bundled);
    return bundled;
  });
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = storage.getSettings();
    // Migrate LLM config to the latest schema (adds `provider` for
    // legacy entries). This is the migration hook for the Anthropic
    // switch — existing localStorage entries that don't have a
    // `provider` field get defaulted to "anthropic" since that's
    // the new default. The user can switch back via Settings.
    return { ...saved, llm: migrateLLMConfig(saved.llm) };
  });
  const [seenReportIds, setSeenReportIds] = useState<string[]>(() => storage.getUnifiedSeenReportIds());
  const [scheduledBatches, setScheduledBatches] = useState<ScheduledBatch[]>(() =>
    storage.getUnifiedScheduledBatches()
  );

  /**
   * Switch active sport. Per ADR 0003, the active sport is a
   * **dashboard filter only** — it controls which sport's fixtures
   * the tournament browser shows. Watchlist / reports / scheduled
   * batches are sport-agnostic and do NOT swap. Templates stay
   * per-sport (different prompts per sport) and reload on switch.
   */
  const setActiveSport = useCallback((sport: Sport) => {
    setActiveSportInternal((current) => {
      if (current === sport) return current;
      storage.setActiveSport(sport);
      // Templates are per-sport (per ADR 0003). Reload for the new
      // sport; fall back to bundled defaults if first run.
      const tpl = storage.getTemplates(sport);
      if (tpl.length > 0) {
        setTemplates(tpl);
      } else {
        const bundled = DEFAULT_TEMPLATES_BY_SPORT[sport] ?? [];
        storage.setTemplates(sport, bundled);
        setTemplates(bundled);
      }
      // Clear the dashboard so we don't briefly show the previous
      // sport's matches while the new fetch is in flight.
      setMatches([]);
      setTournaments([]);
      // Trigger a refetch for the new sport at the current date.
      sportSwitchRef.current += 1;
      return sport;
    });
  }, []);

  /** Bumped on every sport switch; fetchMatches reads this to know
   *  when to refetch for the new sport. */
  const sportSwitchRef = useRef(0);

  // matches
  const [selectedDate, setSelectedDateInternal] = useState<string>(() => formatDateKey(new Date()));
  // Dates the user has explicitly picked. These are skipped by the auto-pick
  // logic so clicking "Quay lại" on an empty date doesn't trigger the
  // auto-pick loop. Synchronous ref so the next fetchMatches call sees it.
  const userPickedDatesRef = useRef<Set<string>>(new Set([formatDateKey(new Date())]));
  const setSelectedDate = useCallback((key: string) => {
    setSelectedDateInternal(key);
    setUserSelectedDate(key);
    // When the user explicitly picks a date, clear the auto-pick banner
    // and remember this date so we don't auto-pick for it on subsequent loads.
    setIsDateAutoPicked(false);
    userPickedDatesRef.current.add(key);
  }, []);
  const [matches, setMatches] = useState<Match[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [isFetchingMatches, setIsFetchingMatches] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [isUsingLiveData, setIsUsingLiveData] = useState(false);
  const [rateLimitUntil, setRateLimitUntil] = useState<Date | null>(null);
  const [cacheSize, setCacheSize] = useState(0);
  const [isDateAutoPicked, setIsDateAutoPicked] = useState(false);
  const [userSelectedDate, setUserSelectedDate] = useState<string>(() => formatDateKey(new Date()));

  // persist (unified for watchlist / reports / batches; per-sport for
  // templates; shared for settings). Per ADR 0003.
  useEffect(() => storage.setUnifiedWatchlist(watchlist), [watchlist]);
  useEffect(() => storage.setUnifiedReports(reports), [reports]);
  useEffect(() => storage.setTemplates(activeSport, templates), [templates, activeSport]);
  useEffect(() => storage.setSettings(settings), [settings]);
  useEffect(() => storage.setUnifiedSeenReportIds(seenReportIds), [seenReportIds]);
  useEffect(() => storage.setUnifiedScheduledBatches(scheduledBatches), [scheduledBatches]);

  // fetch matches
  // Use a ref to read current matches length without re-creating this callback
  // (which would cause fetch → setState → re-create → fetch loops).
  const matchesRef = useRef<Match[]>([]);
  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);

  // Track in-flight fetches by date to dedup concurrent calls (e.g. user
  // clicks refresh at the same time polling fires). The cache handles
  // already-fetched data; this handles "two callers want the same date
  // before the first response arrives".
  const inFlightFetchRef = useRef<Map<string, Promise<void>>>(new Map());

  const fetchMatches = useCallback(async (dateKey: string) => {
    // If we already have a fetch in-flight for this date, share the same promise
    const existing = inFlightFetchRef.current.get(dateKey);
    if (existing) return existing;

    // Respect rate-limit cooldown
    if (rateLimitUntil && Date.now() < rateLimitUntil.getTime()) {
      const wait = Math.ceil((rateLimitUntil.getTime() - Date.now()) / 1000);
      setMatchError(`Đang trong thời gian chờ rate limit. Thử lại sau ${wait}s.`);
      return;
    }

    const work = (async () => {
      setIsFetchingMatches(true);
      setMatchError(null);
      try {
        // Real API path: FlashScore4 (single call per day).
        //   GET /api/flashscore/v2/matches/list-by-date?sport_id={sportId}&date=YYYY-MM-DD&timezone=Asia/Ho_Chi_Minh
        //   Response shape: TBD — mapper handles multiple common patterns
        //   defensively (see src/api/flashscore-mapper.ts for path arrays).
        // Cached 30 min, in-flight deduped inside flashscore.ts.
        const payload = await getMatchesByDate({
          sportId: SPORT_ID_MAP[activeSport],
          date: dateKey,
          timezone: APP_TIMEZONE,
        });
        const payloadInfo = (() => {
          if (Array.isArray(payload)) return `array[${payload.length}]`;
          if (payload && typeof payload === "object") {
            const keys = Object.keys(payload).slice(0, 5).join(",");
            return `object{keys=[${keys}]}`;
          }
          return `typeof=${typeof payload}`;
        })();
        // Diagnostic: log so you can see in DevTools if the call
        // returned 0 (legitimate empty day) or a real payload. The
        // mapper's findMatchesArray() handles all common shapes; this
        // is just a quick top-level sanity check.
        // eslint-disable-next-line no-console
        console.log(
          `[flashscore-api] date=${dateKey} payload=${payloadInfo}`
        );

        const { matches: mappedMatches, tournaments: mappedTournaments } = mapMatchesBatch({
          payload,
          dateKey,
          sport: activeSport,
        });

        setMatches(mappedMatches);
        setTournaments(mappedTournaments);
        setIsUsingLiveData(true);
        setLastFetchedAt(new Date());

        // Smart fallback: if the user-picked date has zero matches (after
        // doubles filtering), look back up to 7 days for the most recent date
        // with matches. Common case on off-days, weekends, or before today's
        // schedule is published. Fires only on the live-API path with 0 matches.
        // Skip if the user has explicitly picked this date (prevents the
        // "click back → auto-pick again" loop).
        if (mappedMatches.length === 0 && !userPickedDatesRef.current.has(dateKey)) {
          const current = parseDateKey(dateKey);
          for (let i = 1; i <= 7; i++) {
            const d = new Date(current);
            d.setDate(d.getDate() - i);
            const key = formatDateKey(d);
            try {
              const fallbackPayload = await getMatchesByDate({
                sportId: SPORT_ID_MAP[activeSport],
                date: key,
                timezone: APP_TIMEZONE,
              });
              const fb = mapMatchesBatch({ payload: fallbackPayload, dateKey: key, sport: activeSport });
              if (fb.matches.length > 0) {
                // eslint-disable-next-line no-console
                console.log(
                  `[flashscore-api] auto-picked ${key} (${fb.matches.length} matches) for empty date ${dateKey}`
                );
                setMatches(fb.matches);
                setTournaments(fb.tournaments);
                setSelectedDateInternal(key);
                setIsDateAutoPicked(true);
                setLastFetchedAt(new Date());
                break;
              }
            } catch {
              // skip and keep searching
            }
          }
        }
      } catch (e) {
        // Special-case 429: set a 60s cooldown so polling + manual refresh
        // pause and don't keep hammering the API.
        if (e instanceof FlashscoreApiError && e.code === "rate_limited") {
          const until = new Date(Date.now() + 60_000);
          setRateLimitUntil(until);
          setMatchError(
            `${e.message} Auto-refresh sẽ tạm dừng đến ${formatTime(until)}.`
          );
        } else if (e instanceof Error) {
          setMatchError(e.message);
        } else {
          setMatchError("Không thể tải dữ liệu trận đấu.");
        }
        // On error: keep the last known good list (if any). If there's no
        // prior data, the empty state will render and prompt the user to
        // fix the issue (check API key, retry, etc.).
      } finally {
        setIsFetchingMatches(false);
        inFlightFetchRef.current.delete(dateKey);
      }
    })();

    inFlightFetchRef.current.set(dateKey, work);
    return work;
  }, [rateLimitUntil, activeSport]);

  // initial fetch
  useEffect(() => {
    fetchMatches(selectedDate);
  }, [selectedDate, fetchMatches]);

  // Derived: are we currently blocked from calling the API due to a 429?
  // Declared before the polling effect so it can be a dep there.
  const isRateLimited = !!rateLimitUntil && Date.now() < rateLimitUntil.getTime();

  const findNearbyDateWithMatches = useCallback(
    async (maxDaysBack = 7): Promise<string | null> => {
      // Sequential day-by-day. Stops at first date with matches. Cache makes
      // repeated calls free (e.g. when user toggles sample data on/off).
      const current = parseDateKey(selectedDate);
      for (let i = 1; i <= maxDaysBack; i++) {
        const d = new Date(current);
        d.setDate(d.getDate() - i);
        const key = formatDateKey(d);
        try {
          const payload = await getMatchesByDate({
            sportId: SPORT_ID_MAP[activeSport],
            date: key,
            timezone: APP_TIMEZONE,
          });
          const { matches: foundMatches } = mapMatchesBatch({ payload, dateKey: key, sport: activeSport });
          if (foundMatches.length > 0) {
            // Switch to that date and mark as auto-picked
            setSelectedDateInternal(key);
            setIsDateAutoPicked(true);
            return key;
          }
        } catch {
          // Skip this date and keep searching
        }
      }
      return null;
    },
    [selectedDate, activeSport]
  );

  const clearAutoPick = useCallback(() => setIsDateAutoPicked(false), []);

  // Polling mechanism. Skipped during rate-limit cooldown AND when
  // `pollingIntervalMinutes === 0` (the "No Poll" setting — user only
  // wants manual refreshes via the Refresh button). This is the explicit
  // opt-out for users who prefer full control over API usage (e.g. tight
  // RapidAPI quota).
  const pollingIntervalRef = useRef<number | null>(null);
  useEffect(() => {
    if (pollingIntervalRef.current) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (isRateLimited) {
      // Don't fire while in cooldown. The tick effect will clear the
      // cooldown; we'll re-create the interval on the next render.
      return;
    }
    // 0 = No Poll — user has explicitly opted out of auto-refresh.
    // Manual refresh via the Refresh button still works (calls
    // fetchMatches directly, bypasses this effect entirely).
    if (settings.pollingIntervalMinutes === 0) {
      return;
    }
    const ms = Math.max(1, settings.pollingIntervalMinutes) * 60 * 1000;
    pollingIntervalRef.current = window.setInterval(() => {
      fetchMatches(selectedDate);
    }, ms);
    return () => {
      if (pollingIntervalRef.current) {
        window.clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [settings.pollingIntervalMinutes, selectedDate, fetchMatches, isRateLimited]);

  // Per-entry background poll (ADR 0003 — cross-sport completion
  // detection). The dashboard fast-path only fires for entries
  // whose match is in the current `matches` array (i.e. active
  // sport, selected date). For cross-sport and cross-date entries
  // we need a separate poll.
  //
  // Batched by `(sport, date)`: pending entries are grouped, each
  // unique pair is fetched once per cycle, and the 30-min cache
  // in `flashscore.ts` (`TTL.listByDate`) dedupes. So 10 pending
  // entries across 3 dates = 3 API calls, not 10.
  //
  // Shares `pollingIntervalMinutes` with the dashboard poll
  // (single knob). Skipped when rate-limited or when polling is
  // disabled (interval === 0).
  //
  // On completion detection: transitions the entry from
  // `pending` to `fetching-pbp` — same transition the dashboard
  // fast-path uses. The runGeneration pipeline picks it up and
  // runs the LLM regardless of `activeSport`.
  const perEntryPollRef = useRef<number | null>(null);
  const perEntryPollInFlightRef = useRef<boolean>(false);
  const watchlistRef = useRef<WatchlistEntry[]>(watchlist);
  useEffect(() => {
    watchlistRef.current = watchlist;
  }, [watchlist]);
  // Stable key over the set of pending entries. Recomputes only
  // when the set changes (add/remove/transition), not on every
  // watchlist mutation.
  const pendingPollKey = useMemo(() => {
    return watchlist
      .filter((e) => e.status === "pending")
      .map((e) => `${e.id}|${e.sport}|${e.matchDate}|${e.matchApiId}`)
      .sort()
      .join(",");
  }, [watchlist]);

  useEffect(() => {
    if (perEntryPollRef.current) {
      window.clearInterval(perEntryPollRef.current);
      perEntryPollRef.current = null;
    }
    if (isRateLimited) return;
    if (settings.pollingIntervalMinutes === 0) return;
    const tick = async () => {
      if (perEntryPollInFlightRef.current) return;
      perEntryPollInFlightRef.current = true;
      try {
        // Snapshot the current pending entries via the ref so
        // the closure doesn't go stale.
        const pending = watchlistRef.current.filter(
          (e) => e.status === "pending"
        );
        if (pending.length === 0) return;

        // Group by (sport, date). Each unique pair is fetched once.
        const byPair = new Map<string, WatchlistEntry[]>();
        for (const entry of pending) {
          const key = `${entry.sport}|${entry.matchDate}`;
          const list = byPair.get(key);
          if (list) list.push(entry);
          else byPair.set(key, [entry]);
        }

        for (const [key, entries] of byPair) {
          const [sport, date] = key.split("|") as [Sport, string];
          const sportId = SPORT_ID_MAP[sport];
          if (!sportId) continue;
          try {
            const payload = await getMatchesByDate({
              sportId,
              date,
              timezone: APP_TIMEZONE,
            });
            const { matches: matched } = mapMatchesBatch({
              payload,
              dateKey: date,
              sport,
            });
            const completedIds = new Set(
              matched
                .filter((m) => m.status === "completed")
                .map((m) => m.id)
            );
            if (completedIds.size === 0) continue;
            const toTrigger = entries.filter((e) =>
              completedIds.has(e.matchApiId)
            );
            if (toTrigger.length === 0) continue;
            const triggerIds = new Set(toTrigger.map((e) => e.id));
            const now = new Date().toISOString();
            setWatchlist((current) => {
              let changed = false;
              const updated = current.map((e) => {
                if (!triggerIds.has(e.id)) return e;
                if (e.status !== "pending") return e;
                changed = true;
                return {
                  ...e,
                  status: "fetching-pbp" as const,
                  pipelineStartedAt: now,
                };
              });
              return changed ? updated : current;
            });
          } catch {
            // Silent fail — the next tick retries. Rate-limit
            // errors propagate through the global listener and
            // pause future ticks via the `isRateLimited` gate.
          }
        }
      } finally {
        perEntryPollInFlightRef.current = false;
      }
    };

    const ms = Math.max(1, settings.pollingIntervalMinutes) * 60 * 1000;
    // Fire one tick immediately so newly-added entries get
    // checked without waiting `ms` for the first interval.
    void tick();
    perEntryPollRef.current = window.setInterval(tick, ms);
    return () => {
      if (perEntryPollRef.current) {
        window.clearInterval(perEntryPollRef.current);
        perEntryPollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.pollingIntervalMinutes,
    isRateLimited,
    pendingPollKey,
  ]);

  // Lazily enrich watchlist matches with per-set details + point-by-point.
  //
  // list-by-date gives us `scores: {home, away}` (set count only) and
  // status, but NOT per-set game scores. Per-set games (6-4, 6-3) and
  // the game-by-game breakdown come from /matches/details and
  // /matches/.../point-by-point respectively.
  //
  // We ONLY fetch these for watchlist matches — not for every completed
  // match on the dashboard. Rationale:
  //   - Dashboard only needs status + set count, both already in
  //     list-by-date. Adding details to the dashboard would burn the
  //     1,000 req/day budget on matches the user never reports on.
  //   - Watchlist matches need full data for the PBP tab + LLM prompt.
  //
  // fetchAndCacheMatchData fires BOTH calls in parallel; partial success
  // is fine (e.g. PBP succeeds but details 429s — we still get PBP).
  //
  // Triggers:
  //   1. addToWatchlist(match) — match is already completed when added
  //   2. watchlist match transitions live/scheduled → completed
  //      (caught by this effect when matches state updates)
  //
  // 7-day cache (in flashscore.ts) means subsequent views return from
  // localStorage without a network call. Failed fetches fail silently —
  // report generation falls back to web search via the LLM tool.
  const enrichRequestedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const watchlistIds = new Set(watchlist.map((e) => e.matchApiId));
    const needsEnrich = matches.filter((m) => {
      if (!watchlistIds.has(m.id)) return false;
      if (m.status !== "completed") return false;
      // Sport-aware: tennis needs sets + PBP. Football v1.5 MVP
      // doesn't enrich (events come from list-by-date).
      if (m.sport === "tennis") {
        const t = m as TennisMatch;
        return (!t.sets || t.sets.length === 0 || !m.pointByPoint) &&
          !enrichRequestedRef.current.has(m.id);
      }
      return false; // football: no enrich in v1.5
    });
    for (const m of needsEnrich) {
      enrichRequestedRef.current.add(m.id);
      void fetchAndCacheMatchData(m.id, enrichRequestedRef, setMatches);
    }
  }, [matches, watchlist]);

  // Helper: after matches OR watchlist change, check if any pending entries
  // have matches that are now completed — kick off the report pipeline.
  useEffect(() => {
    if (matches.length === 0) return;
    setWatchlist((current) => {
      const pendingEntries = current.filter((e) => e.status === "pending");
      if (pendingEntries.length === 0) return current;
      let changed = false;
      const updated = current.map<WatchlistEntry>((entry) => {
        if (entry.status !== "pending") return entry;
        const match = matches.find((m) => m.id === entry.matchApiId);
        if (!match) return entry;
        if (match.status === "completed") {
          changed = true;
          // Move entry to the entry point of the pipeline. The
          // runGeneration function will then walk through
          // fetching-pbp → building-context → (web-searching) →
          // consolidating → completed.
          return {
            ...entry,
            status: "fetching-pbp" as const,
            pipelineStartedAt: new Date().toISOString(),
          };
        }
        return entry;
      });
      return changed ? updated : current;
    });
  }, [matches, watchlist]);

  // Generate reports for entries that just became "generating"
  //
  // Two state pieces here:
  // 1. `generatingInFlightRef` — a Set of watchlist entry ids currently
  //    being generated. Prevents the same entry from being fired twice
  //    when the effect re-runs while a call is in progress.
  // 2. `llmQueueRef` — a serial queue (Promise chain). LLM calls are
  //    chained one after another so concurrent completions don't fire
  //    parallel requests. This matters because:
  //    - Most LLM providers rate-limit by requests/minute, and rapid
  //      succession can hit the cap
  //    - Reasoning models (DeepSeek R1, Qwen QwQ, etc.) take a long
  //      time per call; running 2 in parallel can exhaust the per-call
  //      timeout on the second one
  //    - Single-flight through the queue makes failures local (one bad
  //      call doesn't affect the others)
  const generatingInFlightRef = useRef<Set<string>>(new Set());
  const llmQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    // The pipeline is entry-pointed by "fetching-pbp" (set by the
    // pending-→-active effect above). Any subsequent state
    // (building-context, web-searching, consolidating) is reached from
    // inside runGeneration.
    const PIPELINE_ENTRY_STATES = new Set<WatchlistStatus>([
      "fetching-pbp",
      "building-context",
      "web-searching",
      "consolidating",
    ]);
    const toGenerate = watchlist.filter((e) => PIPELINE_ENTRY_STATES.has(e.status));
    if (toGenerate.length === 0) return;
    toGenerate.forEach((entry) => {
      // Skip if we're already in the middle of generating this one
      if (generatingInFlightRef.current.has(entry.id)) return;
      const match = matches.find((m) => m.id === entry.matchApiId);
      if (!match || match.status !== "completed") {
        // Match was removed or not completed — revert to pending
        setWatchlist((w) => w.map((e) => (e.id === entry.id ? { ...e, status: "pending" as const } : e)));
        return;
      }

      generatingInFlightRef.current.add(entry.id);

      // Chain this call after the previous LLM call in the queue.
      // The queue catches errors so one bad call doesn't break the
      // chain for subsequent calls.
      const queued = llmQueueRef.current.then(
        () => runGeneration(entry, match),
        () => runGeneration(entry, match)  // also run if previous failed
      );
      // Keep the chain alive for the next caller. We don't await the
      // queued promise here — the IIFE inside runGeneration handles
      // its own state updates.
      llmQueueRef.current = queued.catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist, matches, templates, settings]);

  // Helper: run one report-generation, update state, release the
  // in-flight flag. Extracted to keep the effect body readable.
  function runGeneration(entry: WatchlistEntry, match: Match) {
    return (async () => {
      /**
       * State-machine transitions for the report-generation pipeline.
       * Each step's status is committed to state BEFORE the step runs,
       * so the UI can show real-time progress.
       */
      const transition = (
        status: WatchlistStatus,
        patch: Partial<WatchlistEntry> = {},
      ) => {
        setWatchlist((w) =>
          w.map((e) => {
            if (e.id !== entry.id) return e;
            const isFirstNonPending = e.status === "pending" && status !== "pending";
            return {
              ...e,
              ...patch,
              status,
              pipelineStartedAt: isFirstNonPending
                ? new Date().toISOString()
                : e.pipelineStartedAt,
            };
          }),
        );
      };

      try {
        // ─── Step 1: fetch details + (sport-specific extras) ──────────
        // The watchlist match is the ONLY place we call /matches/details
        // (and /matches/.../point-by-point for tennis). The dashboard
        // never fetches these (set count from list-by-date is enough
        // for dashboard rendering), so by the time a match reaches the
        // report pipeline, it should already have at least the basic
        // data cached from the watchlist add / live→completed effect.
        // We re-check here in case the cache was cleared or the match
        // transitioned to completed between sessions.
        //
        // Sport dispatch (ADR 0002):
        //   - tennis   → /matches/details + /point-by-point (parallel)
        //   - football → /matches/details only (PBP is tennis-specific;
        //                football enriches via /details events + stats)
        let matchWithPBP: Match = match;
        const needsTennisEnrich = match.sport === "tennis" && (
          !(match as TennisMatch).sets || (match as TennisMatch).sets!.length === 0 || !(match as TennisMatch).pointByPoint
        );
        const needsFootballEnrich = match.sport === "football" && false; // v1.5 MVP: football events not yet enriched; rely on list-by-date
        const needsEnrich = needsTennisEnrich || needsFootballEnrich;
        if (match.status === "completed" && needsEnrich) {
          transition("fetching-pbp");
          try {
            if (match.sport === "tennis") {
              // Run both calls in parallel; partial success is fine.
              const [detailsResult, pbpResult] = await Promise.allSettled([
                getMatchDetails({ matchId: match.id }).then(mapMatchDetails),
                getPointByPoint({ matchId: match.id }).then(mapPointByPoint),
              ]);

              const patch: Partial<TennisMatch> = {};
              if (
                detailsResult.status === "fulfilled" &&
                detailsResult.value.sets &&
                detailsResult.value.sets.length > 0
              ) {
                patch.sets = detailsResult.value.sets;
                if (detailsResult.value.stats) patch.stats = detailsResult.value.stats;
              }
              if (pbpResult.status === "fulfilled" && pbpResult.value) {
                patch.pointByPoint = pbpResult.value;
              }
              if (Object.keys(patch).length > 0) {
                matchWithPBP = { ...match, ...patch };
                setMatches((current) =>
                  current.map((m) => (m.id === match.id ? ({ ...m, ...patch } as Match) : m))
                );
              }

              if (detailsResult.status === "rejected") {
                console.warn(
                  `[pipeline ${entry.id}] details fetch failed (will continue without):`,
                  detailsResult.reason,
                );
              }
              if (pbpResult.status === "rejected") {
                console.warn(
                  `[pipeline ${entry.id}] PBP fetch failed (will continue without):`,
                  pbpResult.reason,
                );
              }
            } else if (match.sport === "football") {
              // v1.5 MVP: football enrich is a no-op (events/stats not
              // yet consumed by generate.ts). Hook reserved for v1.6.
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[pipeline ${entry.id}] enrich fetch failed (will continue without):`, err);
          }
        }

        // ─── Step 2: build context (pre-LLM prep) ──────────────────
        transition("building-context");
        // The actual data prep happens inside generateReport's
        // buildPromptContext (templates.ts) + formatPointByPointForLLM.
        // Nothing async here, but the state lets the UI show the step.
        // Small artificial yield so the UI can paint the state change.
        await Promise.resolve();

        // ─── Step 3: web-searching (optional) ───────────────────────
        // The LLM itself decides whether to call web_search via the
        // tools it has. We surface this state for ~1.5s after the LLM
        // emits its first web_search tool call (detected via tool name).
        // For simplicity, we just record the state; the LLM is given
        // ~free rein to search or not. This state is observable in
        // the watchlist badge.
        const willNeedWebSearch = settings.llm?.enabled !== false; // heuristic
        if (willNeedWebSearch) {
          transition("web-searching");
          // No actual work here — the LLM does this in the next step.
          // This state is held until the LLM call starts.
          await new Promise((r) => setTimeout(r, 50));
        }

        // ─── Step 4: LLM consolidation ──────────────────────────────
        transition("consolidating");
        const report = await generateReport({
          match: matchWithPBP,
          templates,
          settings,
          watchlistId: entry.id,
        });

        // ─── Step 5: finalize ───────────────────────────────────────
        const winner = getMatchWinner(matchWithPBP);
        // Sport-aware winner name. The dispatch uses `match.sport` so
        // tennis → player1/player2.fullName, football → home/away.name.
        const winnerName = matchWithPBP.sport === "tennis"
          ? (winner === 1
              ? (matchWithPBP as TennisMatch).player1.fullName
              : (matchWithPBP as TennisMatch).player2.fullName)
          : matchWithPBP.sport === "football"
          ? (winner === 1
              ? (matchWithPBP as { home: { name: string } }).home.name
              : (matchWithPBP as { away: { name: string } }).away.name)
          : "—";
        setReports((r) => [report, ...r]);
        transition("completed", {
          finalScore: getFinalScore(matchWithPBP),
          winner: winnerName,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(`[pipeline ${entry.id}] failed:`, err);
        transition("failed", { errorMessage });
      } finally {
        generatingInFlightRef.current.delete(entry.id);
      }
    })();
  }

  // helpers
  const isWatchlisted = useCallback(
    (matchId: string) => watchlist.some((w) => w.matchApiId === matchId),
    [watchlist]
  );

  const getReportByMatch = useCallback(
    (matchId: string) => reports.find((r) => r.matchApiId === matchId),
    [reports]
  );

  const toggleWatchlist = useCallback(
    (match: Match) => {
      setWatchlist((current) => {
        const exists = current.find((w) => w.matchApiId === match.id);
        if (exists) {
          return current.filter((w) => w.id !== exists.id);
        }
        // Sport-aware side names. Tennis uses player1/player2.fullName;
        // football uses home/away.name. The `side1Name` field on the
        // entry is generic — both shapes are valid.
        const side1Name = match.sport === "tennis"
          ? (match as TennisMatch).player1.fullName
          : match.sport === "football"
          ? (match as { home: { name: string } }).home.name
          : "—";
        const side2Name = match.sport === "tennis"
          ? (match as TennisMatch).player2.fullName
          : match.sport === "football"
          ? (match as { away: { name: string } }).away.name
          : "—";
        const side1Flag = match.sport === "tennis"
          ? (match as TennisMatch).player1.countryFlag
          : match.sport === "football"
          ? (match as { home: { countryFlag: string } }).home.countryFlag
          : "";
        const side2Flag = match.sport === "tennis"
          ? (match as TennisMatch).player2.countryFlag
          : match.sport === "football"
          ? (match as { away: { countryFlag: string } }).away.countryFlag
          : "";
        const entry: WatchlistEntry = {
          id: uid(),
          sport: match.sport,
          matchApiId: match.id,
          side1Name,
          side2Name,
          side1Flag,
          side2Flag,
          tournamentName: match.tournamentName,
          tournamentCategory: match.tournamentCategory,
          matchDate: selectedDate,
          startTime: match.startTime,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        return [entry, ...current];
      });
    },
    [selectedDate]
  );

  const removeFromWatchlist = useCallback((entryId: string) => {
    setWatchlist((w) => w.filter((e) => e.id !== entryId));
  }, []);

  /**
   * Explicit "add to watchlist" (vs. toggleWatchlist which also removes).
   * No-op if the match is already watched. Returns the entry id, which
   * is needed by the ScheduleBatchModal when scheduling a match the
   * user picked from the dashboard but hadn't watched yet.
   */
  const addToWatchlist = useCallback(
    (match: Match): string | null => {
      let result: string | null = null;
      let isNewlyAdded = false;
      setWatchlist((current) => {
        const exists = current.find((w) => w.matchApiId === match.id);
        if (exists) {
          result = exists.id;
          return current;
        }
        const id = uid();
        const side1Name = match.sport === "tennis"
          ? (match as TennisMatch).player1.fullName
          : match.sport === "football"
          ? (match as { home: { name: string } }).home.name
          : "—";
        const side2Name = match.sport === "tennis"
          ? (match as TennisMatch).player2.fullName
          : match.sport === "football"
          ? (match as { away: { name: string } }).away.name
          : "—";
        const side1Flag = match.sport === "tennis"
          ? (match as TennisMatch).player1.countryFlag
          : match.sport === "football"
          ? (match as { home: { countryFlag: string } }).home.countryFlag
          : "";
        const side2Flag = match.sport === "tennis"
          ? (match as TennisMatch).player2.countryFlag
          : match.sport === "football"
          ? (match as { away: { countryFlag: string } }).away.countryFlag
          : "";
        const entry: WatchlistEntry = {
          id,
          sport: match.sport,
          matchApiId: match.id,
          side1Name,
          side2Name,
          side1Flag,
          side2Flag,
          tournamentName: match.tournamentName,
          tournamentCategory: match.tournamentCategory,
          matchDate: selectedDate,
          startTime: match.startTime,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        result = id;
        isNewlyAdded = true;
        return [entry, ...current];
      });
      // Trigger 2: if the match is already completed and was just added to
      // the watchlist, fire the enrich fetch immediately. (For live/scheduled
      // matches, the useEffect above will catch the transition later.)
      // Sport-aware: tennis needs sets + PBP; football v1.5 MVP needs no
      // additional enrich (events come from list-by-date, not /details).
      const tennisMatch = match.sport === "tennis" ? (match as TennisMatch) : null;
      const needsTennisEnrich = tennisMatch
        ? !tennisMatch.sets || tennisMatch.sets.length === 0 || !(match as TennisMatch).pointByPoint
        : false;
      if (
        isNewlyAdded &&
        match.status === "completed" &&
        needsTennisEnrich &&
        !enrichRequestedRef.current.has(match.id)
      ) {
        enrichRequestedRef.current.add(match.id);
        void fetchAndCacheMatchData(match.id, enrichRequestedRef, setMatches);
      }
      return result;
    },
    [selectedDate]
  );

  const markReportSeen = useCallback((reportId: string) => {
    setSeenReportIds((s) => (s.includes(reportId) ? s : [...s, reportId]));
    setReports((rs) => rs.map((r) => (r.id === reportId ? { ...r, isNew: false } : r)));
  }, []);

  const updateReport = useCallback((reportId: string, patch: Partial<Report>) => {
    setReports((rs) =>
      rs.map((r) =>
        r.id === reportId ? { ...r, ...patch, editedAt: new Date().toISOString() } : r
      )
    );
  }, []);

  const acknowledgeReport = useCallback((reportId: string) => {
    setReports((rs) =>
      rs.map((r) => {
        if (r.id !== reportId) return r;
        if (!r.quality) return r; // legacy report, no-op
        if (r.quality.status === "reviewed") return r;
        return {
          ...r,
          quality: {
            ...r.quality,
            status: "reviewed",
            acknowledgedAt: new Date().toISOString(),
          },
        };
      })
    );
  }, []);

  const addTemplate = useCallback((t: Omit<ReportTemplate, "id">) => {
    setTemplates((ts) => [...ts, { ...t, id: uid() }]);
  }, []);

  const updateTemplate = useCallback((id: string, patch: Partial<ReportTemplate>) => {
    setTemplates((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const deleteTemplate = useCallback((id: string) => {
    setTemplates((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const setDefaultTemplate = useCallback((id: string) => {
    setTemplates((ts) => ts.map((t) => ({ ...t, isDefault: t.id === id })));
    setSettings((s) => ({ ...s, defaultTemplateId: id }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const refreshMatches = useCallback(
    () => fetchMatches(selectedDate),
    [fetchMatches, selectedDate]
  );

  const dismissMatchError = useCallback(() => setMatchError(null), []);

  const testApiConnection = useCallback(async (): Promise<string | null> => {
    try {
      // Cheap ping: list-by-date for today. A successful response confirms
      // the server-side RapidAPI configuration.
      const today = formatDateKey(new Date());
      const res = await getMatchesByDate({
        sportId: SPORT_ID_MAP[activeSport],
        date: today,
        timezone: settings.timezone || "Asia/Ho_Chi_Minh",
      });
      // No error thrown → server configuration is valid
      void res;
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Lỗi không xác định.";
    }
  }, [activeSport, settings.timezone]);

  const clearApiCacheAndRefresh = useCallback(() => {
    clearApiCache();
    // Eagerly clear the visual size indicator; the real value will refresh
    // after the next fetch.
    setCacheSize(0);
    fetchMatches(selectedDate);
  }, [fetchMatches, selectedDate]);

  /**
   * Delete ALL reports (final articles + LLM-generated + prompt-only).
   * Also clears seenReportIds so the next batch of generated reports
   * shows the "Mới" badge again. Watchlist entries are NOT touched —
   * they will re-trigger report generation for completed matches on
   * the next status change, so the user effectively gets a fresh
   * batch of reports. Templates, settings, and match cache are
   * untouched.
   */
  const clearAllReports = useCallback(() => {
    setReports([]);
    setSeenReportIds([]);
  }, []);

  /* -------------------------------------------------------------- */
  /* Scheduled batches (ADR 0001)                                   */
  /* -------------------------------------------------------------- */

  // Recovery on app load: if a batch is "running", it was interrupted
  // (page reload mid-run, tab close mid-run, etc.). The timer is lost.
  // Reset to "pending" so the firing mechanism re-claims and re-runs.
  // Already-written entries will be detected as "already-written" on
  // the next pass; not-yet-written entries get a fresh attempt.
  useEffect(() => {
    setScheduledBatches((b) =>
      b.map((x) => (x.status === "running" ? { ...x, status: "pending" as const } : x))
    );
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atomic claim ref — prevents the same batch from being fired twice
  // when both setTimeout and the polling-backup tick try to claim it
  // within the same millisecond.
  const batchClaimedRef = useRef<Set<string>>(new Set());

  /**
   * Try to claim a single batch. If it's still pending and fireAt is
   * past, transition to "running". Idempotent via batchClaimedRef.
   */
  const tryClaimBatch = useCallback((batchId: string) => {
    if (batchClaimedRef.current.has(batchId)) return;
    setScheduledBatches((current) => {
      const batch = current.find((b) => b.id === batchId);
      if (!batch || batch.status !== "pending") return current;
      if (new Date(batch.fireAt).getTime() > Date.now()) return current;
      batchClaimedRef.current.add(batchId);
      return current.map((b) =>
        b.id === batchId && b.status === "pending" ? { ...b, status: "running" as const } : b
      );
    });
  }, []);

  // Primary firing: setTimeout per pending batch. Provides precision
  // when the tab is active. On cleanup (batch state changes, unmount),
  // timers are cleared.
  useEffect(() => {
    const timers: number[] = [];
    for (const batch of scheduledBatches) {
      if (batch.status !== "pending") continue;
      const delay = new Date(batch.fireAt).getTime() - Date.now();
      if (delay > 0) {
        const id = window.setTimeout(() => tryClaimBatch(batch.id), delay);
        timers.push(id);
      } else {
        // Already past due — claim on the next tick (the polling-backup
        // effect below picks it up).
        tryClaimBatch(batch.id);
      }
    }
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [scheduledBatches, tryClaimBatch]);

  // Backup firing: 10s tick. Catches batches that the setTimeout missed
  // (browser throttle, backgrounded tab, system sleep). Also acts as
  // the recovery path for batches that were "running" on app load and
  // got reset to "pending" by the recovery effect above.
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      for (const batch of scheduledBatches) {
        if (batch.status !== "pending") continue;
        if (new Date(batch.fireAt).getTime() <= now) {
          tryClaimBatch(batch.id);
        }
      }
    };
    tick();
    const id = window.setInterval(tick, 10_000);
    return () => window.clearInterval(id);
  }, [scheduledBatches, tryClaimBatch]);

  // Run batches that have been claimed ("running"). This effect is the
  // single trigger for runScheduledBatch; batchInFlightRef prevents
  // re-entry when the runner mutates state.
  const batchInFlightRef = useRef<Set<string>>(new Set());
  const runScheduledBatch = useCallback(
    async (batchId: string) => {
      const batch = scheduledBatches.find((b) => b.id === batchId);
      if (!batch || batch.status !== "running") return;
      if (batchInFlightRef.current.has(batchId)) return;
      batchInFlightRef.current.add(batchId);

      // Snapshot the entries + sort by start time (ascending) per Q3=A.
      // Resolve from current watchlist. Missing entries → record as
      // skipped (watchlist entry was deleted before batch fired).
      const sortedEntries = batch.watchlistEntryIds
        .map((id) => watchlist.find((e) => e.id === id))
        .filter((e): e is WatchlistEntry => !!e)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      const results: BatchEntryResult[] = [];
      const counts = {
        written: 0,
        alreadyWritten: 0,
        skippedNotEnded: 0,
        skippedCancelled: 0,
        failed: 0,
      };

      // Iterate strictly serially (Q4=E) by chaining onto the existing
      // llmQueueRef. This also keeps scheduled-batch LLM calls
      // interleaved correctly with any in-flight auto-on-completion
      // calls — never two concurrent LLM requests.
      let chain: Promise<unknown> = Promise.resolve();
      for (const entry of sortedEntries) {
        chain = chain.then(async () => {
          // Already have a report? → already-written.
          const existing = reports.find((r) => r.watchlistId === entry.id);
          if (existing) {
            counts.alreadyWritten += 1;
            results.push({ watchlistId: entry.id, outcome: "already-written", reportId: existing.id });
            return;
          }
          // Look up current match data in the store.
          const match = matches.find((m) => m.id === entry.matchApiId);
          if (!match) {
            // Match not in current store (different date not yet polled).
            // Treat as not-ended: skip, don't fetch fresh data in Phase 2.
            // TODO: cross-date fetch in v2.
            counts.skippedNotEnded += 1;
            results.push({ watchlistId: entry.id, outcome: "skipped-not-ended" });
            return;
          }
          if (match.status !== "completed") {
            counts.skippedNotEnded += 1;
            results.push({ watchlistId: entry.id, outcome: "skipped-not-ended" });
            return;
          }

          // Try generation with inline retry (Q6=C: 1-2x). Each attempt
          // catches its own errors; only if all attempts fail do we
          // record "failed" and move on.
          const maxAttempts = 2;
          let lastError: unknown = null;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
              const report = await generateReport({
                match,
                templates,
                settings,
                watchlistId: entry.id,
                triggeredBy: "scheduled-batch",
              });
              setReports((r) => [report, ...r]);
              counts.written += 1;
              results.push({ watchlistId: entry.id, outcome: "written", reportId: report.id });
              return;
            } catch (e) {
              lastError = e;
              if (attempt < maxAttempts - 1) {
                // Brief pause between retries (1s). Keeps the chain
                // responsive without hammering a flaky LLM API.
                await new Promise((r) => setTimeout(r, 1000));
              }
            }
          }
          counts.failed += 1;
          results.push({
            watchlistId: entry.id,
            outcome: "failed",
            errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
          });
        });
      }

      // Wait for all entries to finish before sealing the batch.
      await chain;

      const summary: BatchSummary = {
        total: sortedEntries.length,
        ...counts,
        results,
      };
      const status: "completed" | "partial" = counts.failed > 0 ? "partial" : "completed";

      setScheduledBatches((current) =>
        current.map((b) =>
          b.id === batchId
            ? { ...b, status, summary, completedAt: new Date().toISOString() }
            : b
        )
      );
      // Clear batchId from the entries that were in this batch. The
      // entries themselves stay in the watchlist (auto-on-completion
      // may still need to handle them if they're not yet completed).
      setWatchlist((w) => w.map((e) => (e.batchId === batchId ? { ...e, batchId: undefined } : e)));
      batchInFlightRef.current.delete(batchId);
    },
    [scheduledBatches, watchlist, reports, matches, templates, settings]
  );

  useEffect(() => {
    const runningBatches = scheduledBatches.filter((b) => b.status === "running");
    for (const batch of runningBatches) {
      void runScheduledBatch(batch.id);
    }
  }, [scheduledBatches, runScheduledBatch]);

  // Batch CRUD. addScheduledBatch returns the new batch's id so the
  // UI (Phase 3) can route the user to the new batch's detail view.
  const addScheduledBatch = useCallback(
    (input: Omit<ScheduledBatch, "id" | "createdAt" | "status" | "completedAt" | "summary">) => {
      const id = uid();
      const batch: ScheduledBatch = {
        ...input,
        id,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      setScheduledBatches((b) => [...b, batch]);
      // Mark each entry with batchId so the watchlist sidebar can show
      // the ⏰ badge. If any entry id doesn't exist in watchlist, skip
      // (defensive — the UI should not allow this).
      setWatchlist((w) =>
        w.map((e) => (batch.watchlistEntryIds.includes(e.id) ? { ...e, batchId: id } : e))
      );
      return id;
    },
    []
  );

  const updateScheduledBatch = useCallback(
    (id: string, patch: Partial<ScheduledBatch>) => {
      setScheduledBatches((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      // If watchlistEntryIds changed, sync the batchId on entries:
      // newly-added entries get this batchId; entries that were
      // removed lose it.
      if (patch.watchlistEntryIds) {
        const newIds = new Set(patch.watchlistEntryIds);
        setWatchlist((w) =>
          w.map((e) => {
            if (newIds.has(e.id)) return { ...e, batchId: id };
            if (e.batchId === id) return { ...e, batchId: undefined };
            return e;
          })
        );
      }
    },
    []
  );

  const cancelScheduledBatch = useCallback((id: string) => {
    setScheduledBatches((b) =>
      b.map((x) =>
        x.id === id && x.status === "pending"
          ? { ...x, status: "cancelled" as const, completedAt: new Date().toISOString() }
          : x
      )
    );
    // Clear batchId on any entries that were pointing at this batch.
    setWatchlist((w) => w.map((e) => (e.batchId === id ? { ...e, batchId: undefined } : e)));
  }, []);

  const removeScheduledBatch = useCallback((id: string) => {
    setScheduledBatches((b) => b.filter((x) => x.id !== id));
    setWatchlist((w) => w.map((e) => (e.batchId === id ? { ...e, batchId: undefined } : e)));
  }, []);

  const hasRunningBatch = scheduledBatches.some((b) => b.status === "running");

  // Register a global rate-limit listener so a 429 from ANY caller
  // (list-by-date, details, PBP) pauses the dashboard polling, manual
  // refresh, and the per-match details/PBP effects for the cooldown
  // window. Without this, only fetchMatches was wired to set
  // rateLimitUntil, so a 429 from getMatchDetails / getPointByPoint
  // slipped through and the next match's fetch kept hammering the API.
  useEffect(() => {
    setRateLimitedListener((until) => {
      setRateLimitUntil(until);
      setMatchError(
        `Tennis API đã vượt giới hạn request. Auto-refresh và per-match fetch sẽ tạm dừng đến ${formatTime(until)}.`
      );
    });
    return () => setRateLimitedListener(null);
  }, []);

  // Tick every 10s to: (a) auto-clear rateLimitUntil when it expires, and
  // (b) refresh the cache size indicator for the Settings UI.
  useEffect(() => {
    const tick = () => {
      if (rateLimitUntil && Date.now() >= rateLimitUntil.getTime()) {
        setRateLimitUntil(null);
        setMatchError(null);
      }
      // localStorage may have changed in another tab; re-read size lazily
      try {
        let n = 0;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("trh:apiCache:")) n++;
        }
        setCacheSize(n);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = window.setInterval(tick, 10_000);
    return () => window.clearInterval(id);
  }, [rateLimitUntil]);

  const value = useMemo<AppState>(
    () => ({
      activeSport,
      selectedDate,
      userSelectedDate,
      matches,
      tournaments,
      isFetchingMatches,
      matchError,
      lastFetchedAt,
      isUsingLiveData,
      rateLimitUntil,
      cacheSize,
      isDateAutoPicked,
      watchlist,
      reports,
      templates,
      settings,
      seenReportIds,
      scheduledBatches,
      isWatchlisted,
      getReportByMatch,
      setSelectedDate,
      setActiveSport,
      refreshMatches,
      toggleWatchlist,
      addToWatchlist,
      removeFromWatchlist,
      markReportSeen,
      updateReport,
      acknowledgeReport,
      addTemplate,
      updateTemplate,
      deleteTemplate,
      setDefaultTemplate,
      updateSettings,
      dismissMatchError,
      testApiConnection,
      clearApiCacheAndRefresh,
      clearAllReports,
      isRateLimited,
      findNearbyDateWithMatches,
      clearAutoPick,
      addScheduledBatch,
      updateScheduledBatch,
      cancelScheduledBatch,
      removeScheduledBatch,
      hasRunningBatch,
    }),
    [
      activeSport,
      selectedDate,
      userSelectedDate,
      matches,
      tournaments,
      isFetchingMatches,
      matchError,
      lastFetchedAt,
      isUsingLiveData,
      rateLimitUntil,
      cacheSize,
      isDateAutoPicked,
      watchlist,
      reports,
      templates,
      settings,
      seenReportIds,
      scheduledBatches,
      isWatchlisted,
      getReportByMatch,
      setSelectedDate,
      setActiveSport,
      refreshMatches,
      toggleWatchlist,
      addToWatchlist,
      removeFromWatchlist,
      markReportSeen,
      updateReport,
      acknowledgeReport,
      addTemplate,
      updateTemplate,
      deleteTemplate,
      setDefaultTemplate,
      updateSettings,
      dismissMatchError,
      testApiConnection,
      clearApiCacheAndRefresh,
      clearAllReports,
      isRateLimited,
      findNearbyDateWithMatches,
      clearAutoPick,
      addScheduledBatch,
      updateScheduledBatch,
      cancelScheduledBatch,
      removeScheduledBatch,
      hasRunningBatch,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
