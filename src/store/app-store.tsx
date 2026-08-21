import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction, type ReactNode } from "react";
import type {
  BatchEntryResult,
  BatchSummary,
  Match,
  Report,
  ReportTemplate,
  ScheduledBatch,
  Settings,
  Tournament,
  WatchlistEntry,
  WatchlistStatus,
} from "@/types";
import { storage } from "./persistence";
import { DEFAULT_TEMPLATES, migrateBundledTemplates } from "@/reports/templates";
import { migrateLLMConfig } from "@/api/llm";
import { generateReport, getMatchWinner, getFinalScore } from "@/reports/generate";
import { buildSubmitPayload, shouldAutoSubmit } from "@/lib/submit-payload";
import { submitMatch } from "@/api/backend";
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

interface AppState {
  // data
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
  refreshMatches: () => Promise<void>;
  toggleWatchlist: (match: Match) => void;
  /** Explicit add (idempotent). Returns the entry id, or null if the
   *  match was not found. Used by the schedule modal. */
  addToWatchlist: (match: Match) => string | null;
  removeFromWatchlist: (entryId: string) => void;
  markReportSeen: (reportId: string) => void;
  updateReport: (reportId: string, patch: Partial<Report>) => void;
  addTemplate: (t: Omit<ReportTemplate, "id">) => void;
  updateTemplate: (id: string, patch: Partial<ReportTemplate>) => void;
  deleteTemplate: (id: string) => void;
  setDefaultTemplate: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  dismissMatchError: () => void;
  /** Test the configured API key by fetching today's ATP fixtures.
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
  apiKey: string,
  requestedRef: MutableRefObject<Set<string>>,
  setMatches: Dispatch<SetStateAction<Match[]>>,
): Promise<{ sets?: Match["sets"]; pointByPoint?: Match["pointByPoint"]; stats?: Match["stats"] }> {
  // Fire both calls in parallel. allSettled guarantees we get both
  // outcomes even if one rejects.
  const [detailsResult, pbpResult] = await Promise.allSettled([
    getMatchDetails({ apiKey, matchId }).then(mapMatchDetails),
    getPointByPoint({ apiKey, matchId }).then(mapPointByPoint),
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
  const patch: Partial<Match> = {};
  if (details?.sets && details.sets.length > 0) patch.sets = details.sets;
  if (details?.stats) patch.stats = details.stats;
  if (pbp && pbp.sets.length > 0) patch.pointByPoint = pbp;

  if (Object.keys(patch).length > 0) {
    setMatches((current) =>
      current.map((m) => (m.id === matchId ? { ...m, ...patch } : m))
    );
  }

  return { sets: patch.sets, pointByPoint: patch.pointByPoint, stats: patch.stats };
}

export function AppProvider({ children }: { children: ReactNode }) {
  // user data
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>(() => storage.getWatchlist());
  const [reports, setReports] = useState<Report[]>(() => storage.getReports());
  const [templates, setTemplates] = useState<ReportTemplate[]>(() => {
    const saved = storage.getTemplates();
    if (saved.length > 0) {
      // Migrate any stale bundled copies (e.g. older tpl-prompt) to the
      // current bundled content. User-created templates are preserved.
      const migrated = migrateBundledTemplates(saved);
      if (migrated !== saved) storage.setTemplates(migrated);
      return migrated;
    }
    storage.setTemplates(DEFAULT_TEMPLATES);
    return DEFAULT_TEMPLATES;
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
  const [seenReportIds, setSeenReportIds] = useState<string[]>(() => storage.getSeenReportIds());
  const [scheduledBatches, setScheduledBatches] = useState<ScheduledBatch[]>(() =>
    storage.getScheduledBatches()
  );

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

  // persist
  useEffect(() => storage.setWatchlist(watchlist), [watchlist]);
  useEffect(() => storage.setReports(reports), [reports]);
  useEffect(() => storage.setTemplates(templates), [templates]);
  useEffect(() => storage.setSettings(settings), [settings]);
  useEffect(() => storage.setSeenReportIds(seenReportIds), [seenReportIds]);
  useEffect(() => storage.setScheduledBatches(scheduledBatches), [scheduledBatches]);

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
        const apiKey = settings.rapidApiKey?.trim() ?? "";

        if (!apiKey) {
          // No API key configured → show empty state with a clear guidance
          // message. The user must configure a key in Settings before the
          // app can show real data.
          setMatches([]);
          setTournaments([]);
          setIsUsingLiveData(false);
          setLastFetchedAt(null);
          setMatchError("Chưa cấu hình Tennis API key. Vào Settings để nhập key và bắt đầu xem dữ liệu thật.");
          return;
        }

        // Real API path: FlashScore4 (single call per day).
        //   GET /api/flashscore/v2/matches/list-by-date?sport_id=2&date=YYYY-MM-DD&timezone=Asia/Ho_Chi_Minh
        //   Response shape: TBD — mapper handles multiple common patterns
        //   defensively (see src/api/flashscore-mapper.ts for path arrays).
        // Cached 30 min, in-flight deduped inside flashscore.ts.
        const payload = await getMatchesByDate({
          apiKey,
          sportId: 2, // tennis
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
                apiKey,
                sportId: 2,
                date: key,
                timezone: APP_TIMEZONE,
              });
              const fb = mapMatchesBatch({ payload: fallbackPayload, dateKey: key });
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
  }, [settings.rapidApiKey, rateLimitUntil]);

  // initial fetch
  useEffect(() => {
    fetchMatches(selectedDate);
  }, [selectedDate, fetchMatches]);

  // Derived: are we currently blocked from calling the API due to a 429?
  // Declared before the polling effect so it can be a dep there.
  const isRateLimited = !!rateLimitUntil && Date.now() < rateLimitUntil.getTime();

  const findNearbyDateWithMatches = useCallback(
    async (maxDaysBack = 7): Promise<string | null> => {
      if (!settings.rapidApiKey?.trim()) return null;
      // Sequential day-by-day. Stops at first date with matches. Cache makes
      // repeated calls free (e.g. when user toggles sample data on/off).
      const current = parseDateKey(selectedDate);
      for (let i = 1; i <= maxDaysBack; i++) {
        const d = new Date(current);
        d.setDate(d.getDate() - i);
        const key = formatDateKey(d);
        try {
          const payload = await getMatchesByDate({
            apiKey: settings.rapidApiKey,
            sportId: 2,
            date: key,
            timezone: APP_TIMEZONE,
          });
          const { matches: foundMatches } = mapMatchesBatch({ payload, dateKey: key });
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
    [settings.rapidApiKey, selectedDate]
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
    if (!settings.rapidApiKey?.trim()) return;
    const apiKey = settings.rapidApiKey.trim();
    const watchlistIds = new Set(watchlist.map((e) => e.matchApiId));
    const needsEnrich = matches.filter(
      (m) =>
        watchlistIds.has(m.id) &&
        m.status === "completed" &&
        // Trigger if EITHER sets OR PBP is missing — the helper
        // patches whichever it can fetch.
        (!m.sets || m.sets.length === 0 || !m.pointByPoint) &&
        !enrichRequestedRef.current.has(m.id)
    );
    for (const m of needsEnrich) {
      enrichRequestedRef.current.add(m.id);
      void fetchAndCacheMatchData(m.id, apiKey, enrichRequestedRef, setMatches);
    }
  }, [matches, watchlist, settings.rapidApiKey]);

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
          // Auto-submit lên n8n backend pipeline (nếu được bật) —
          // fire-and-forget: lỗi backend không chặn pipeline local.
          if (shouldAutoSubmit({ backendEnabled: settings.backendEnabled !== false, entryStatus: entry.status, matchStatus: match.status })) {
            const payload = buildSubmitPayload(match, "tennis");
            submitMatch(payload).catch((err) => {
              // eslint-disable-next-line no-console
              console.warn(`[backend] submit match ${match.id} failed:`, err);
            });
          }
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
  }, [matches, watchlist, settings.backendEnabled]);

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
        // ─── Step 1: fetch details + PBP (parallel) ──────────────────
        // The watchlist match is the ONLY place we call /matches/details
        // and /matches/.../point-by-point. The dashboard never fetches
        // these (set count from list-by-date is enough for dashboard
        // rendering), so by the time a match reaches the report
        // pipeline, it should already have at least one of {sets,
        // pointByPoint} cached from the watchlist add / live→completed
        // effect. We re-check here in case the cache was cleared or the
        // match transitioned to completed between sessions.
        let matchWithPBP = match;
        if (
          match.status === "completed" &&
          (!match.sets || match.sets.length === 0 || !match.pointByPoint) &&
          settings.rapidApiKey?.trim()
        ) {
          transition("fetching-pbp");
          try {
            const apiKey = settings.rapidApiKey.trim();
            // Run both calls in parallel; partial success is fine.
            const [detailsResult, pbpResult] = await Promise.allSettled([
              getMatchDetails({ apiKey, matchId: match.id }).then(mapMatchDetails),
              getPointByPoint({ apiKey, matchId: match.id }).then(mapPointByPoint),
            ]);

            const patch: Partial<Match> = {};
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
                current.map((m) => (m.id === match.id ? { ...m, ...patch } : m))
              );
            }

            if (detailsResult.status === "rejected") {
              // eslint-disable-next-line no-console
              console.warn(
                `[pipeline ${entry.id}] details fetch failed (will continue without):`,
                detailsResult.reason,
              );
            }
            if (pbpResult.status === "rejected") {
              // eslint-disable-next-line no-console
              console.warn(
                `[pipeline ${entry.id}] PBP fetch failed (will continue without):`,
                pbpResult.reason,
              );
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
        const winnerName = winner === 1 ? matchWithPBP.player1.fullName : matchWithPBP.player2.fullName;
        setReports((r) => [report, ...r]);
        transition("completed", {
          finalScore: getFinalScore(matchWithPBP.sets || []),
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
        const entry: WatchlistEntry = {
          id: uid(),
          matchApiId: match.id,
          player1Name: match.player1.fullName,
          player2Name: match.player2.fullName,
          player1Flag: match.player1.countryFlag,
          player2Flag: match.player2.countryFlag,
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
        const entry: WatchlistEntry = {
          id,
          matchApiId: match.id,
          player1Name: match.player1.fullName,
          player2Name: match.player2.fullName,
          player1Flag: match.player1.countryFlag,
          player2Flag: match.player2.countryFlag,
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
      if (
        isNewlyAdded &&
        match.status === "completed" &&
        (!match.sets || match.sets.length === 0 || !match.pointByPoint) &&
        settings.rapidApiKey?.trim() &&
        !enrichRequestedRef.current.has(match.id)
      ) {
        enrichRequestedRef.current.add(match.id);
        const apiKey = settings.rapidApiKey.trim();
        void fetchAndCacheMatchData(match.id, apiKey, enrichRequestedRef, setMatches);
      }
      return result;
    },
    [selectedDate, settings.rapidApiKey]
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
    const apiKey = settings.rapidApiKey?.trim() ?? "";
    if (!apiKey) return "Chưa nhập API key.";
    try {
      // Cheap ping: list-by-date for today. Returns 200 + (possibly empty)
      // Stages list. If we get a 200, the key + host combo works.
      const today = formatDateKey(new Date());
      const res = await getMatchesByDate({
        apiKey,
        sportId: 2,
        date: today,
        timezone: settings.timezone || "Asia/Ho_Chi_Minh",
      });
      // No error thrown → key is valid
      void res;
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Lỗi không xác định.";
    }
  }, [settings.rapidApiKey]);

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

  // Clear API cache when the key changes (so a different subscription's
  // cached data — which would be the same data anyway — doesn't surprise
  // the user; also resets the rate-limit cooldown which was for the old key).
  useEffect(() => {
    clearApiCache();
    setRateLimitUntil(null);
  }, [settings.rapidApiKey]);

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
      refreshMatches,
      toggleWatchlist,
      addToWatchlist,
      removeFromWatchlist,
      markReportSeen,
      updateReport,
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
      refreshMatches,
      toggleWatchlist,
      addToWatchlist,
      removeFromWatchlist,
      markReportSeen,
      updateReport,
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
