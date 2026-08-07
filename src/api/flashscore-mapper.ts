/**
 * Maps FlashScore4 API response → app's Match[] + Tournament[] shapes.
 *
 * Source: src/api/flashscore.ts (flashscore4.p.rapidapi.com)
 *
 * Verified response shape (from a real sample, 2026-08-03):
 *
 *   [
 *     {
 *       "tournament_id": "rspybozh",
 *       "tournament_url": "/tennis/atp-singles/los-cabos/",
 *       "name": "ATP - SINGLES: Los Cabos (Mexico), hard",
 *       "country_name": null,
 *       "image_path": "https://...png",
 *       "matches": [
 *         {
 *           "match_id": "hGi3Zbwp",
 *           "match_status": {
 *             "stage": "Finished",
 *             "is_cancelled": false,
 *             "is_postponed": false,
 *             "is_started": true,
 *             "is_in_progress": false,
 *             "is_finished": true,
 *             "is_finished_after_extra_time": false,
 *             "is_finished_after_penalties": false,
 *             "live_time": null,
 *             "live_minute": null,
 *             "winner": null,
 *             "final_winner": null
 *           },
 *           "timestamp": 1785552000,         // Unix epoch seconds
 *           "home_team": {
 *             "team_id": "zJqvgzz6",
 *             "name": "Wong C.",
 *             "short_name": "WON",
 *             "small_image_path": "https://flagcdn.com/w40/hk.png"  // flag URL, parse for ISO code
 *           },
 *           "away_team": { ... },
 *           "scores": { "home": 0, "away": 2 },   // SETS won (NOT per-set game scores)
 *           "odds": { "1": 2.08, "2": 1.72, "X": null }
 *         }
 *       ]
 *     },
 *     ...
 *   ]
 *
 * Parsing rules:
 *   - Tournament name "ATP - SINGLES: Los Cabos (Mexico), hard" is parsed into:
 *       category: "ATP 250" (default; tier not in this example)
 *       cleanName: "Los Cabos"
 *       location: "Mexico" (from "(Country)" suffix)
 *       surface: "hard" (last comma-separated segment)
 *   - Doubles tournaments (name contains "DOUBLES") are filtered out — UI is singles-only.
 *   - Player country comes from the flagcdn URL (alpha-2 code, e.g. "hk" → "HK").
 *   - Match status uses `match_status.stage` first (most reliable — it's a
 *     human-readable enum like "NotStarted" / "InProgress" / "Finished" /
 *     "Postponed" / "Cancelled" / "Awarded" / "Retired" / set-level like
 *     "1st Set"). Booleans (`is_finished`, `is_in_progress`, etc.) are a
 *     fallback for when `stage` is missing or unrecognized.
 *   - The `scores` field is SETS won (e.g., 0-2 = away won in straight sets). Per-set
 *     game scores (6-4, 6-3 etc.) are NOT exposed by list-by-date — `Match.sets` stays
 *     undefined. Reports fall back to `finalScore` derived from scores.
 *
 * Backwards compat: still tries older livescore6-style shapes
 * ({ Stages: [{ Events: [...] }] }) and flat { matches: [...] } for safety.
 */

import type {
  Match,
  MatchStatus,
  Participant,
  PointByPointData,
  PointByPointGame,
  SetScore,
  Sport,
  TennisMatchStats,
  Tournament,
  TournamentCategory,
} from "@/types";
import { flagFromAlpha2 } from "./country-flags";

/** Local alias for the tennis player shape. */
type Player = Extract<Participant, { kind: "player" }>;

/** Local alias — TennisMatchStats is the new name (was MatchStats). */
type MatchStats = TennisMatchStats;

/* ------------------------------------------------------------------ */
/*  Field extractors                                                   */
/* ------------------------------------------------------------------ */

function extractField<T = unknown>(obj: unknown, paths: string[]): T | undefined {
  for (const path of paths) {
    const parts = path.split(".");
    let cur: any = obj;
    let ok = true;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") {
        ok = false;
        break;
      }
      cur = cur[p];
    }
    if (ok && cur !== undefined && cur !== null) return cur as T;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Tournament parsing                                                 */
/* ------------------------------------------------------------------ */

// Surface whitelist matches Tournament["surface"] type. Unknown values
// (e.g. "carpet", "indoor hard") fall back to "hard".
const SURFACE_WHITELIST = new Set(["hard", "clay", "grass"]);

interface ParsedTournamentName {
  category: TournamentCategory;
  surface: "hard" | "clay" | "grass";
  location: string;
  cleanName: string;
}

function parseTournamentName(fullName: string): ParsedTournamentName {
  // "ATP - SINGLES: Los Cabos (Mexico), hard"
  const parts = fullName.split(/,\s*/);
  const lastSegment = (parts[parts.length - 1] ?? "").toLowerCase().trim();
  const surface: ParsedTournamentName["surface"] = SURFACE_WHITELIST.has(lastSegment)
    ? (lastSegment as ParsedTournamentName["surface"])
    : "hard";
  const nameNoSurface = parts.length > 1 ? parts.slice(0, -1).join(", ") : fullName;

  const locMatch = nameNoSurface.match(/\(([^)]+)\)/);
  const location = locMatch ? locMatch[1].trim() : "";

  // Strip category prefix like "ATP - SINGLES: ", "WTA - DOUBLES: ", "GRAND SLAM - SINGLES: "
  // and trailing "(Country)" tag
  const cleanName =
    nameNoSurface
      .replace(/^[A-Z][A-Z0-9 -]+:\s*/i, "")
      .replace(/\s*\([^)]+\)\s*$/, "")
      .trim() || nameNoSurface;

  // Category from prefix (default ATP 250 — tier not exposed in this endpoint)
  const upper = fullName.toUpperCase();
  let category: TournamentCategory = "ATP 250";
  if (upper.includes("WTA")) category = "WTA 250";
  else if (upper.includes("CHALLENGER")) category = "Challenger";
  else if (upper.includes("ITF") || upper.includes("UTR") || upper.includes("FUTURES")) {
    category = "ITF";
  } else if (upper.includes("GRAND SLAM")) category = "Grand Slam";

  return { category, surface, location, cleanName };
}

function isDoublesTournament(t: any): boolean {
  const name = String(
    t?.name ?? t?.tournament_name ?? t?.Snm ?? ""
  ).toLowerCase();
  // Some non-English APIs may use different terms; English "doubles" is the
  // common case based on the example data.
  return name.includes("doubles") || name.includes("dvojice") || name.includes("dobles");
}

function buildTournament(raw: any, dateKey: string): Tournament {
  const fullName = String(
    raw?.name ?? raw?.tournament_name ?? raw?.Snm ?? "Unknown Tournament"
  );
  // Keep the FULL name (with category prefix + location + surface) — UI
  // shows it as-is, matching flashscore.com layout. Category/surface/location
  // are also extracted for the badge, icon, and tooltip.
  const { category, surface, location } = parseTournamentName(fullName);
  const id = String(
    raw?.tournament_id ?? raw?.id ?? raw?.Sid ?? `t-${fullName}`
  );
  return {
    id,
    name: fullName, // include prefix + location + surface
    category,
    location,
    surface,
    date: dateKey,
    sport: "tennis", // v1.5 MVP: mapper is tennis-only; football v1.6
  };
}

/* ------------------------------------------------------------------ */
/*  Country / flag extraction                                          */
/* ------------------------------------------------------------------ */

/**
 * Extract ISO 3166-1 alpha-2 country code from a flagcdn URL.
 * Example: "https://flagcdn.com/w40/hk.png" → "HK"
 * Returns "" if the URL doesn't match the expected pattern.
 */
function extractCountryFromFlagUrl(url: string | undefined | null): string {
  if (!url) return "";
  const m = String(url).match(/flagcdn\.com\/[a-z0-9]+\/([a-z0-9]+)\.png/i);
  if (!m) return "";
  return m[1].toUpperCase();
}

function buildPlayerFromTeam(team: any): Player {
  if (!team || typeof team !== "object") {
    return { kind: "player" as const, name: "TBD", fullName: "TBD", country: "", countryFlag: "🏳️" };
  }
  // The API's `name` field is already the full name (e.g. "Wong C." for
  // Asian names, "Alex de Minaur" for Western). We use it as BOTH `name`
  // and `fullName` because the 3-letter `short_name` ("WON", "GEA") is
  // too cryptic to be useful as the visible name. Templates can still
  // truncate with CSS if needed for narrow rows.
  const fullName = String(
    team?.name ?? team?.full_name ?? team?.Nm ?? "TBD"
  ).trim() || "TBD";

  // Country: prefer flagcdn URL alpha-2, fall back to team.country_name
  const flagUrl: string | undefined = team?.small_image_path ?? team?.image_path;
  const alpha2 = extractCountryFromFlagUrl(flagUrl);
  const country =
    alpha2 ||
    (typeof team?.country_name === "string" ? team.country_name.trim() : "") ||
    "";

  // Flag emoji via the country-flags module (alpha-2 → emoji).
  const countryFlag = alpha2 ? flagFromAlpha2(alpha2) : "🏳️";

  return {
    kind: "player" as const,
    name: fullName,
    fullName,
    country,
    countryFlag,
  };
}

/**
 * Build a `Team` participant for football matches. Similar to
 * `buildPlayerFromTeam` but emits `kind: "team"` and exposes `shortName`
 * (used in compact UI like the match row's score badge). The mapper is
 * v1.5 MVP-grade: it derives `shortName` from the team's `short_name`
 * field if present, otherwise from the first 3 chars of the full name.
 * v1.6 can refine this once we have real football samples to inspect.
 */
function buildTeamFromTeam(team: any): Extract<Participant, { kind: "team" }> {
  if (!team || typeof team !== "object") {
    return {
      kind: "team" as const,
      name: "TBD",
      shortName: "TBD",
      country: "",
      countryFlag: "🏳️",
    };
  }
  const fullName = String(
    team?.name ?? team?.full_name ?? team?.Nm ?? "TBD"
  ).trim() || "TBD";
  const shortName = String(team?.short_name ?? team?.shortName ?? "").trim() ||
    fullName.slice(0, 3).toUpperCase();
  const flagUrl: string | undefined = team?.small_image_path ?? team?.image_path ?? team?.logo_path;
  const alpha2 = extractCountryFromFlagUrl(flagUrl);
  const country =
    alpha2 ||
    (typeof team?.country_name === "string" ? team.country_name.trim() : "") ||
    "";
  const countryFlag = alpha2 ? flagFromAlpha2(alpha2) : "🏳️";
  return {
    kind: "team" as const,
    name: fullName,
    shortName,
    country,
    countryFlag,
    logoUrl: typeof team?.image_path === "string" ? team.image_path : undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  Match status                                                       */
/* ------------------------------------------------------------------ */

function parseMatchStatus(matchStatus: any): MatchStatus {
  if (!matchStatus || typeof matchStatus !== "object") return "scheduled";

  // PRIMARY: use the `stage` field — it's a human-readable enum from the API
  // (e.g. "NotStarted", "InProgress", "Finished", "Postponed", "Cancelled",
  // "Awarded", "Walkover", "Retired", "Suspended", "1st Set", ...).
  // More reliable than booleans which can have inconsistent combinations
  // (e.g. is_started=true and is_finished=false could mean live OR a stale
  // state where stage already says "Finished").
  const stageRaw = String(matchStatus.stage ?? "").trim();
  const stage = stageRaw.toLowerCase();

  if (stage) {
    // ---- Completed (terminal states, no more play) ----
    if (
      stage === "finished" ||
      stage === "ft" ||
      stage === "awarded" || // walkover win
      stage === "walkover" || // explicit walkover
      stage === "wo" || // walkover abbreviation
      stage === "retired" || // player retired mid-match (per CONTEXT: report still generated)
      stage === "cancelled" || // per CONTEXT: cancelled = completed (no live report)
      stage === "canceled" || // US spelling
      stage === "abandoned" || // mid-match stoppage, score kept
      stage === "aet" || // after extra time (rare in tennis, defensive)
      stage === "after extra time"
    ) {
      return "completed";
    }
    // ---- Live (in progress, any reason) ----
    if (
      stage === "inprogress" ||
      stage === "in progress" ||
      stage === "live" ||
      stage === "playing" ||
      stage === "active" ||
      // Tennis set-level granularity: "1st Set", "2nd Set", "3rd Set", ...
      // or "Set 1", "Set 2" ... or "S1" (livescore6 abbreviation)
      /^(\d+)(st|nd|rd|th)?\s*set$/i.test(stage) ||
      /^set\s*\d+$/i.test(stage) ||
      stage === "s1" || stage === "s2" || stage === "s3" || stage === "s4" || stage === "s5" ||
      // Common tennis interruption states — still "live" (could resume)
      stage === "break" ||
      stage === "medical timeout" ||
      stage === "rain delay" ||
      stage === "challenge" || // Hawkeye/line challenge
      stage === "interrupted" // mid-match interruption
    ) {
      return "live";
    }
    // ---- Scheduled (pre-match, waiting) ----
    if (
      stage === "notstarted" ||
      stage === "not started" ||
      stage === "ns" ||
      stage === "scheduled" ||
      stage === "tba" || // to be announced
      stage === "tbd" || // to be determined
      stage === "postponed" || // delayed
      stage === "suspended" || // paused before play
      stage === "delayed" ||
      stage === "w.o." // pre-match walkover
    ) {
      return "scheduled";
    }
    // Unrecognized stage string — fall through to booleans
  }

  // FALLBACK: booleans (used when stage is missing or unrecognized).
  // These are less reliable but can disambiguate when stage is absent.
  if (matchStatus.is_cancelled) return "completed";
  if (
    matchStatus.is_finished ||
    matchStatus.is_finished_after_extra_time ||
    matchStatus.is_finished_after_penalties
  ) {
    return "completed";
  }
  if (matchStatus.is_in_progress) return "live";
  if (matchStatus.is_postponed) return "scheduled";
  // is_started is the weakest signal (true for both live and just-completed
  // matches where booleans weren't updated yet). Only use as a last resort
  // when stage is unknown AND no other boolean is set.
  if (matchStatus.is_started) return "live";

  return "scheduled";
}

/* ------------------------------------------------------------------ */
/*  Time parsing                                                       */
/* ------------------------------------------------------------------ */

function parseStartTime(raw: unknown): string {
  if (raw == null) return new Date().toISOString();
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Unix epoch (seconds or ms heuristic). Real sample shows seconds
    // (e.g. 1785552000), so multiply by 1000 for sub-1e12 values.
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const s = String(raw).trim();
  if (s.includes("T") || /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString();
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/*  Match builder                                                      */
/* ------------------------------------------------------------------ */

function buildMatch(
  raw: any,
  tournament: Tournament,
  dateKey: string,
  index: number,
  sport: Sport
): Match {
  const matchId = String(
    raw?.match_id ??
      raw?.id ??
      raw?.matchId ??
      raw?.eid ??
      raw?.Eid ??
      `unknown-${index}-${dateKey}`
  );

  const status = parseMatchStatus(raw?.match_status);

  // Prefer match.timestamp (epoch seconds per sample), then other time fields
  const timestampRaw = extractField(raw, [
    "timestamp",
    "start_time",
    "startTime",
    "time",
    "kickoff",
    "Esd",
  ]);
  const startTime = parseStartTime(timestampRaw);

  // Round: API may not expose per-match round in this endpoint. Keep fallback.
  const round =
    extractField<string>(raw, ["round", "round_name", "roundName"]) ?? "—";

  // Scores — from list-by-date's `scores: {home, away}`. For tennis
  // this is SETS won, for football this is FINAL GOALS. The same
  // `scores` field works for both — only the semantic differs, which
  // is why we branch below.
  const rawScores = extractField<{ home?: number; away?: number }>(raw, [
    "scores",
    "score",
    "result",
  ]);
  const finalScore: { side1: number; side2: number } | undefined =
    rawScores &&
    typeof rawScores === "object" &&
    (typeof rawScores.home === "number" || typeof rawScores.away === "number")
      ? {
          side1: rawScores.home ?? 0,
          side2: rawScores.away ?? 0,
        }
      : undefined;

  // Halftime score (football only — best effort from common path names).
  const halftimeScore: { side1: number; side2: number } | undefined = (() => {
    const raw = extractField<{ home?: number; away?: number }>(rawScores, [
      "ht_score",
      "halftime",
      "half_time",
    ]);
    if (!raw || typeof raw !== "object") return undefined;
    if (typeof raw.home !== "number" && typeof raw.away !== "number") return undefined;
    return { side1: raw.home ?? 0, side2: raw.away ?? 0 };
  })();

  // Venue + referee (football). Best effort; many list-by-date payloads
  // don't include these (they come from /matches/details). Leave
  // undefined if not present — the UI handles missing values.
  const venue = extractField<string>(raw, ["venue", "stadium", "ground"]);
  const referee = extractField<string>(raw, ["referee", "referee_name"]);

  if (sport === "football") {
    const home = buildTeamFromTeam(raw?.home_team);
    const away = buildTeamFromTeam(raw?.away_team);
    return {
      id: matchId,
      sport: "football" as const,
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      tournamentCategory: tournament.category,
      round,
      startTime,
      status,
      finalScore,
      halftimeScore,
      venue,
      referee,
      home,
      away,
      // events + stats are NOT populated from list-by-date; the per-match
      // /matches/details enrichment (mapMatchDetails) handles them.
    };
  }

  // tennis (default)
  const player1 = buildPlayerFromTeam(raw?.home_team);
  const player2 = buildPlayerFromTeam(raw?.away_team);
  return {
    id: matchId,
    sport: "tennis" as const,
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    tournamentCategory: tournament.category,
    round,
    startTime,
    status,
    finalScore, // v1.5: keep using finalScore for tennis too (rename-friendly)
    setsWon: finalScore, // legacy alias; tennis UI reads setsWon
    player1,
    player2,
    // NOTE: sets[] not populated from list-by-date endpoint — per-set game
    // scores (6-4, 6-3) are not in this payload. Per-set detail comes
    // from the /matches/details enrichment.
  };
}

/* ------------------------------------------------------------------ */
/*  Top-level shape detection                                          */
/* ------------------------------------------------------------------ */

/**
 * Normalize the top-level payload to an array of "tournament-like" objects,
 * each with a `matches` array property. Handles:
 *
 *   Pattern F (verified): top-level array of tournament objects
 *                         [{ matches: [...] }, { matches: [...] }]
 *   Pattern A: top-level array of matches
 *              [match, match, match] → wrap as [{ matches: [...] }]
 *   Pattern B: { matches: [...] } → wrap as [{ matches: [...] }]
 *   Pattern C: { data: [...] } → wrap as [{ matches: [...] }]
 *   Pattern E: { Stages: [{ Events: [...] }] } → wrap each Stage
 *
 * Returns [] if no recognizable shape.
 */
function findTournamentsArray(payload: unknown): any[] {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return [];
    const first = payload[0];
    if (first && typeof first === "object") {
      // If first item has its own `matches` array → array of tournaments
      if (Array.isArray((first as any).matches)) {
        return payload;
      }
    }
    // Otherwise it's a flat match list — wrap as a single synthetic tournament
    return [{ matches: payload.filter((x) => x && typeof x === "object") }];
  }
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;

  // Direct keys → flat match list
  for (const key of ["matches", "data", "events", "fixtures", "results", "items"]) {
    if (Array.isArray(obj[key])) {
      return [
        {
          matches: (obj[key] as any[]).filter((x) => x && typeof x === "object"),
        },
      ];
    }
  }
  // Nested: payload.result.matches / payload.response.matches / etc.
  for (const wrap of ["result", "response", "payload", "body"]) {
    const inner = obj[wrap];
    if (inner && typeof inner === "object") {
      for (const key of ["matches", "data", "events", "fixtures", "results", "items"]) {
        if (Array.isArray((inner as any)[key])) {
          return [
            {
              matches: ((inner as any)[key] as any[]).filter(
                (x) => x && typeof x === "object"
              ),
            },
          ];
        }
      }
    }
  }
  // Livescore6-style: Stages[].Events[] — wrap each Stage
  for (const stagesKey of ["Stages", "stages"]) {
    if (Array.isArray(obj[stagesKey])) {
      return (obj[stagesKey] as any[])
        .filter((s) => s && typeof s === "object")
        .map((stage) => {
          const eventsKey = Array.isArray((stage as any).Events)
            ? "Events"
            : Array.isArray((stage as any).events)
              ? "events"
              : null;
          return {
            ...stage,
            name: (stage as any).name ?? (stage as any).Snm ?? "Unknown Tournament",
            matches: eventsKey ? (stage as any)[eventsKey] : [],
          };
        });
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/*  Public mapper                                                      */
/* ------------------------------------------------------------------ */

export function mapMatchesBatch({
  payload,
  dateKey,
  sport,
}: {
  payload: unknown;
  dateKey: string;
  sport: Sport;
}): { matches: Match[]; tournaments: Tournament[] } {
  const tournamentsRaw = findTournamentsArray(payload);

  if (tournamentsRaw.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[flashscore-mapper] No tournaments found. Top-level type: ${typeof payload}, keys: ${payload && typeof payload === "object" ? Object.keys(payload).join(", ") : "(none)"}`
    );
    return { matches: [], tournaments: [] };
  }

  const tournamentMap = new Map<string, Tournament>();
  const matches: Match[] = [];
  let matchIndex = 0;
  let skippedDoubles = 0;

  for (const t of tournamentsRaw) {
    if (!t || typeof t !== "object") continue;
    if (isDoublesTournament(t)) {
      skippedDoubles += 1;
      continue;
    }

    const tInfo = buildTournament(t, dateKey);
    tournamentMap.set(tInfo.id, tInfo);

    const rawMatches = Array.isArray(t.matches) ? t.matches : [];
    for (const m of rawMatches) {
      if (!m || typeof m !== "object") continue;
      matches.push(buildMatch(m, tInfo, dateKey, matchIndex++, sport));
    }
  }

  if (skippedDoubles > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[flashscore-mapper] Filtered out ${skippedDoubles} doubles tournament(s) (singles-only UI)`
    );
  }
  if (matches.length === 0 && tournamentsRaw.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[flashscore-mapper] ${tournamentsRaw.length} tournament(s) found but 0 matches extracted. Check match field paths.`
    );
  }

  return {
    matches,
    tournaments: Array.from(tournamentMap.values()),
  };
}

/* ================================================================== */
/*  Match details mapper                                              */
/* ================================================================== */
/*                                                                   */
/*  Used after a match transitions to "completed" status to enrich   */
/*  the Match with per-set game scores (Match.sets) and detailed     */
/*  stats (Match.stats) that list-by-date doesn't expose.           */
/*                                                                   */
/*  Expected output:                                                */
/*    {                                                              */
/*      sets: SetScore[] | undefined,                                */
/*      stats: MatchStats | undefined,                              */
/*      winner: 1 | 2 | undefined,                                    */
/*      finalScore: string | undefined,                              */
/*      matchDurationMinutes: number | undefined,                    */
/*    }                                                             */
/*                                                                   */
/*  Response shape TBD — defensive, handles several common patterns. */
/*  Paste a real sample to refine.                                  */
/* ================================================================== */

export interface MappedMatchDetails {
  /** Per-set game scores (e.g. [{p1:6,p2:4}, {p1:3,p2:6}, {p1:6,p2:3}]). */
  sets?: SetScore[];
  /** Match statistics (aces, double faults, first serve %, etc.). */
  stats?: MatchStats;
  /** 1 if player1 won, 2 if player2 won. */
  winner?: 1 | 2;
  /** Human-readable final score string, e.g. "6-4, 3-6, 6-3". */
  finalScore?: string;
  /** Total match duration in minutes. */
  matchDurationMinutes?: number;
}

function extractFirstNumber(obj: unknown, paths: string[]): number | undefined {
  const v = extractField<unknown>(obj, paths);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (!isNaN(n)) return n;
  }
  return undefined;
}

/**
 * Parse a duration string into total minutes.
 * FlashScore formats: "H:MM" (e.g. "1:30" = 90 min) or "H:MM:SS".
 * For tennis, durations are always under 6 hours, so H:MM is the
 * common case. We treat the first segment as hours if there are 2
 * parts (H:MM) and as minutes:seconds if there are 3 parts (MM:SS).
 * To disambiguate, we use a simple heuristic: if first segment is
 * > 23, treat as minutes (MM:SS); otherwise H:MM.
 */
function parseMatchTimeString(time: string): number | undefined {
  const parts = time.split(":").map((s) => parseInt(s, 10));
  if (parts.some(isNaN)) return undefined;
  if (parts.length === 2) {
    const [a, b] = parts;
    // Tennis matches are typically 1-5 hours. If first > 23, treat as
    // MM:SS (defensive — unlikely for tennis).
    if (a > 23) {
      return a + Math.floor(b / 60); // convert SS→min
    }
    return a * 60 + b; // H:MM
  }
  if (parts.length === 3) {
    const [a, b, c] = parts;
    // H:MM:SS
    return a * 60 + b + Math.floor(c / 60);
  }
  return undefined;
}

/**
 * Walk the payload tree looking for a node that has a `sets`-like field
 * directly on it. Returns that node, or undefined. Handles up to 4 levels
 * of nesting (e.g., `{ data: { result: { match: { sets: [...] } } } }`).
 */
function findSetsNode(payload: unknown, depth = 0): any | undefined {
  if (depth > 4 || !payload || typeof payload !== "object") return undefined;
  const obj = payload as any;
  // Direct hit — has a sets-like field
  if (
    Array.isArray(obj.sets) ||
    Array.isArray(obj.set_scores) ||
    Array.isArray(obj.period_scores) ||
    Array.isArray(obj.periods) ||
    Array.isArray(obj.setResults) ||
    Array.isArray(obj.score_history) ||
    (obj.scores && typeof obj.scores === "object" && Array.isArray(obj.scores.sets))
  ) {
    return obj;
  }
  // Recurse into wrapper keys
  const wrapperKeys = [
    "data", "match", "result", "response", "payload", "item", "items",
    "matchInfo", "match_info", "matchData", "match_data",
    "matchDetails", "match_details", "details",
  ];
  for (const key of wrapperKeys) {
    if (obj[key] && typeof obj[key] === "object") {
      const found = findSetsNode(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

/** Unwrap one level of common wrappers. Returns the first object-valued
 *  wrapper or the payload itself. */
function unwrapOneLevel(payload: unknown): any | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const keys = ["data", "match", "result", "response", "payload", "item", "items"];
  for (const k of keys) {
    const v = (payload as any)[k];
    if (v && typeof v === "object") return v;
  }
  return undefined;
}

/**
 * Walk the entire payload tree looking for the first array of objects
 * that looks like set-score data (each object has a pair of player-score
 * fields). Last-resort fallback when direct paths fail. Up to 5 levels
 * deep, scans all branches.
 */
function findSetsArray(payload: unknown, depth = 0): any[] | null {
  if (depth > 5 || !payload || typeof payload !== "object") return null;
  const obj = payload as any;
  if (Array.isArray(obj)) {
    // Check if this array looks like set data: array of objects with
    // a "pair field" (any of the known scoring key combos).
    if (obj.length > 0 && obj.every((it) => it && typeof it === "object" && !Array.isArray(it))) {
      const hasPairField = obj.some(
        (it) =>
          ("home" in it && "away" in it) ||
          ("home_score" in it && "away_score" in it) ||
          ("score1" in it && "score2" in it) ||
          ("first" in it && "second" in it) ||
          ("player1" in it && "player2" in it) ||
          ("p1" in it && "p2" in it) ||
          ("team1" in it && "team2" in it) ||
          ("homeScore" in it && "awayScore" in it)
      );
      // Reject arrays where the pair fields are strings (e.g. team names
      // like "Wong C." / "Gea A." which also have "name" pairs). We want
      // numeric pair fields. Accept only if at least one pair is numeric.
      if (hasPairField) {
        const first = obj[0];
        const hasNumericPair =
          typeof first.home === "number" ||
          typeof first.home_score === "number" ||
          typeof first.score1 === "number" ||
          typeof first.first === "number" ||
          typeof first.player1 === "number" ||
          typeof first.p1 === "number" ||
          typeof first.homeScore === "number";
        if (hasNumericPair) return obj;
      }
    }
    // Recurse into each array item (in case sets is nested inside an array)
    for (const item of obj) {
      const found = findSetsArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  // Object: recurse into each value
  for (const key of Object.keys(obj)) {
    const found = findSetsArray(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Map a /matches/details payload into MappedMatchDetails.
 * Defensive — returns whatever fields it can find. Callers should treat
 * missing fields as "not exposed by the API" and fall back to scratch data
 * from list-by-date.
 */
export function mapMatchDetails(payload: unknown): MappedMatchDetails {
  if (!payload || typeof payload !== "object") return {};

  // Some APIs wrap details in { data: {...} } or { match: {...} } or
  // { result: {...} }, possibly nested 2-3 levels deep. Walk the tree
  // looking for a node that has a sets-like field.
  const obj = findSetsNode(payload) ?? unwrapOneLevel(payload) ?? payload;

  const out: MappedMatchDetails = {};

  /* ---------------------------------------------------------------- */
  /*  Per-set scores                                                   */
  /* ---------------------------------------------------------------- */
  // PATTERN X (FlashScore verified): flat-field pattern in `scores`:
  //   { scores: { home: 2, away: 0,
  //               home_1set: 6, away_1set: 3,
  //               home_1set_tiebreak: null, away_1set_tiebreak: null,
  //               home_2set: 6, away_2set: 4, ..., home_5set: null } }
  // Up to 5 sets (men's best-of-5). null = unplayed set.
  const scoresObj = extractField<Record<string, unknown>>(obj, ["scores"]);
  let flatFieldSets: SetScore[] | undefined;
  if (scoresObj && typeof scoresObj === "object") {
    flatFieldSets = [];
    for (let setNum = 1; setNum <= 5; setNum++) {
      const p1 = scoresObj[`home_${setNum}set`];
      const p2 = scoresObj[`away_${setNum}set`];
      if (typeof p1 === "number" && typeof p2 === "number") {
        const setScore: SetScore = { player1: p1, player2: p2 };
        const tb1 = scoresObj[`home_${setNum}set_tiebreak`];
        const tb2 = scoresObj[`away_${setNum}set_tiebreak`];
        if (typeof tb1 === "number" && typeof tb2 === "number") {
          setScore.tiebreak = { player1: tb1, player2: tb2 };
        }
        flatFieldSets.push(setScore);
      }
    }
    if (flatFieldSets.length === 0) flatFieldSets = undefined;

    // Also extract total match duration if available (format "H:MM" or "H:MM:SS")
    if (flatFieldSets && flatFieldSets.length > 0) {
      const totalTime = scoresObj.time;
      if (typeof totalTime === "string") {
        const parsed = parseMatchTimeString(totalTime);
        if (parsed !== undefined) out.matchDurationMinutes = parsed;
      }
    }
  }

  if (flatFieldSets && flatFieldSets.length > 0) {
    out.sets = flatFieldSets;
    return out; // got everything we need from this endpoint
  }

  // PATTERN A–G (other APIs): array-based
  //   A: { sets: [{home, away, tiebreak?}, ...] }
  //   B: { scores: { sets: [...] } }
  //   C: { set_scores: [...] }
  //   D: { period_scores: [...] } (sportradar-style)
  //   E: { home_score: { sets: [...] }, away_score: { sets: [...] } }
  //   F: { setResults: [{first, second, ...}], ... }
  //   G: { score_history: [...] }
  const setsRaw =
    extractField<unknown[]>(obj, ["sets", "set_scores", "period_scores", "periods", "setResults", "score_history"]) ??
    extractField<unknown>(obj, ["scores.sets", "score.sets", "result.sets", "score_detail.sets"]) as unknown[] | undefined;

  if (Array.isArray(setsRaw) && setsRaw.length > 0) {
    const sets: SetScore[] = [];
    for (const s of setsRaw) {
      if (!s || typeof s !== "object") continue;
      const p1 = extractFirstNumber(s, [
        "home", "home_score", "score1", "player1", "p1", "team1", "first",
        "homeScore", "home_score_value", "score_home", "games_home",
      ]);
      const p2 = extractFirstNumber(s, [
        "away", "away_score", "score2", "player2", "p2", "team2", "second",
        "awayScore", "away_score_value", "score_away", "games_away",
      ]);
      if (p1 === undefined || p2 === undefined) continue;
      // Tiebreak sub-score (e.g., 7-6(7-3) → tiebreak: {7, 3})
      const tb1 = extractFirstNumber(s, [
        "home_tb", "home_tiebreak", "tiebreak.home", "tb1",
        "tiebreak_score1", "tiebreakScore1", "tiebreak_first",
        "tb_score1", "tb.home", "tie_break.home", "home_tb_score",
      ]);
      const tb2 = extractFirstNumber(s, [
        "away_tb", "away_tiebreak", "tiebreak.away", "tb2",
        "tiebreak_score2", "tiebreakScore2", "tiebreak_second",
        "tb_score2", "tb.away", "tie_break.away", "away_tb_score",
      ]);
      const setScore: SetScore = { player1: p1, player2: p2 };
      if (tb1 !== undefined && tb2 !== undefined) {
        setScore.tiebreak = { player1: tb1, player2: tb2 };
      }
      sets.push(setScore);
    }
    if (sets.length > 0) {
      out.sets = sets;
    } else {
      // Diagnostic: had an array but couldn't extract any valid sets
      // eslint-disable-next-line no-console
      console.warn(
        `[flashscore-details] Found sets array (${setsRaw.length} items) but couldn't extract p1/p2. First item:`,
        JSON.stringify(setsRaw[0]).slice(0, 300)
      );
    }
  } else {
    // Diagnostic: no sets found by direct path. Try the aggressive tree
    // walker as a last resort — look for any array of pair-objects in the
    // payload tree. If even that fails, log enough of the response for
    // debugging.
    const treeSets = findSetsArray(payload);
    if (Array.isArray(treeSets) && treeSets.length > 0) {
      const sets: SetScore[] = [];
      for (const s of treeSets) {
        if (!s || typeof s !== "object") continue;
        const p1 = extractFirstNumber(s, [
          "home", "home_score", "score1", "player1", "p1", "team1", "first",
          "homeScore", "home_score_value", "score_home", "games_home",
        ]);
        const p2 = extractFirstNumber(s, [
          "away", "away_score", "score2", "player2", "p2", "team2", "second",
          "awayScore", "away_score_value", "score_away", "games_away",
        ]);
        if (p1 === undefined || p2 === undefined) continue;
        sets.push({ player1: p1, player2: p2 });
      }
      if (sets.length > 0) {
        out.sets = sets;
        return out; // skip the rest of the function, we have what we need
      }
    }
    // No sets found anywhere. Log enough of the response for debugging.
    // eslint-disable-next-line no-console
    console.warn(
      `[flashscore-details] No sets found. Top-level keys: ${payload && typeof payload === "object" ? Object.keys(payload).join(", ") : "(none)"}.` +
        `\n  Full response:\n${JSON.stringify(payload, null, 2).slice(0, 3000)}`
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Final score string                                               */
  /* ---------------------------------------------------------------- */
  // E.g. "6-4, 3-6, 6-3"
  const finalScoreStr = extractField<string>(obj, [
    "final_score",
    "finalScore",
    "score_string",
    "scoreString",
    "result_string",
    "resultString",
    "match_score",
  ]);
  if (finalScoreStr) {
    out.finalScore = finalScoreStr;
  } else if (out.sets && out.sets.length > 0) {
    // Derive from sets if not provided directly
    out.finalScore = out.sets
      .map((s) => {
        const tb = s.tiebreak ? `(${s.tiebreak.player1}-${s.tiebreak.player2})` : "";
        return `${s.player1}-${s.player2}${tb}`;
      })
      .join(", ");
  }

  /* ---------------------------------------------------------------- */
  /*  Winner                                                           */
  /* ---------------------------------------------------------------- */
  const winnerRaw = extractField<unknown>(obj, [
    "winner",
    "match_winner",
    "final_winner",
    "winner_id",
    "winning_team",
  ]);
  if (winnerRaw === 1 || winnerRaw === "1" || winnerRaw === "home" || winnerRaw === "home_team") {
    out.winner = 1;
  } else if (winnerRaw === 2 || winnerRaw === "2" || winnerRaw === "away" || winnerRaw === "away_team") {
    out.winner = 2;
  }

  /* ---------------------------------------------------------------- */
  /*  Match stats                                                      */
  /* ---------------------------------------------------------------- */
  // Stats are commonly in { statistics: { ... } } or { stats: { ... } }
  const statsRaw =
    extractField<unknown>(obj, ["statistics", "stats", "match_stats", "matchStats"]);
  if (statsRaw && typeof statsRaw === "object") {
    const s = statsRaw as Record<string, unknown>;
    const stats: MatchStats = {
      aces: {
        player1: extractFirstNumber(s, ["aces.home", "aces.player1", "aces.p1", "home_aces"]) ?? 0,
        player2: extractFirstNumber(s, ["aces.away", "aces.player2", "aces.p2", "away_aces"]) ?? 0,
      },
      doubleFaults: {
        player1: extractFirstNumber(s, ["double_faults.home", "doubleFaults.player1", "double_faults.p1", "home_double_faults"]) ?? 0,
        player2: extractFirstNumber(s, ["double_faults.away", "doubleFaults.player2", "double_faults.p2", "away_double_faults"]) ?? 0,
      },
      firstServePct: {
        player1: extractFirstNumber(s, ["first_serve_pct.home", "firstServePct.player1", "first_serve.home", "home_first_serve_pct"]) ?? 0,
        player2: extractFirstNumber(s, ["first_serve_pct.away", "firstServePct.player2", "first_serve.away", "away_first_serve_pct"]) ?? 0,
      },
      breakPointsConverted: {
        player1: extractFirstNumber(s, ["break_points_converted.home", "breakPointsConverted.player1", "break_points_converted.p1", "home_bp_converted"]) ?? 0,
        player2: extractFirstNumber(s, ["break_points_converted.away", "breakPointsConverted.player2", "break_points_converted.p2", "away_bp_converted"]) ?? 0,
      },
      breakPointsFaced: {
        player1: extractFirstNumber(s, ["break_points_faced.home", "breakPointsFaced.player1", "break_points_faced.p1", "home_bp_faced"]) ?? 0,
        player2: extractFirstNumber(s, ["break_points_faced.away", "breakPointsFaced.player2", "break_points_faced.p2", "away_bp_faced"]) ?? 0,
      },
      totalPointsWon: {
        player1: extractFirstNumber(s, ["total_points_won.home", "totalPointsWon.player1", "total_points.home", "home_total_points"]) ?? 0,
        player2: extractFirstNumber(s, ["total_points_won.away", "totalPointsWon.player2", "total_points.away", "away_total_points"]) ?? 0,
      },
      matchDurationMinutes: extractFirstNumber(obj, [
        "match_duration",
        "matchDuration",
        "matchDurationMinutes",
        "duration_minutes",
      ]) ?? extractFirstNumber(s, ["match_duration", "duration_minutes"]) ?? 0,
    };
    // Only assign if at least one non-zero field was found
    const hasAnyStat = (
      stats.aces.player1 + stats.aces.player2 +
      stats.doubleFaults.player1 + stats.doubleFaults.player2 +
      stats.firstServePct.player1 + stats.firstServePct.player2 +
      stats.breakPointsConverted.player1 + stats.breakPointsConverted.player2 +
      stats.breakPointsFaced.player1 + stats.breakPointsFaced.player2 +
      stats.totalPointsWon.player1 + stats.totalPointsWon.player2 +
      stats.matchDurationMinutes
    ) > 0;
    if (hasAnyStat) out.stats = stats;
  } else {
    // Stats might be at the top level (some APIs do this)
    const topMatchDuration = extractFirstNumber(obj, [
      "match_duration", "matchDuration", "matchDurationMinutes", "duration_minutes",
    ]);
    if (topMatchDuration !== undefined) {
      out.matchDurationMinutes = topMatchDuration;
    }
  }

  return out;
}

/* ================================================================== */
/*  Point-by-point mapper                                             */
/* ================================================================== */
/*                                                                   */
/*  Maps /matches/match/point-by-point payload into PointByPointData. */
/*                                                                   */
/*  Verified response shape (real sample, 2026-08-03):              */
/*                                                                   */
/*    [                                                              */
/*      {                                                           */
/*        "name": "Set 1",                                          */
/*        "description": "Point by point - Set 1",                  */
/*        "games": [                                                */
/*          {                                                       */
/*            "home_games": 1, "away_games": 0,                     */
/*            "game_winner": 1, "is_break": null, "server": 1,      */
/*            "point_sequence": "15:0, 30:0, 40:0, 40:15, ..."     */
/*          },                                                     */
/*          ...                                                     */
/*        ]                                                         */
/*      },                                                         */
/*      ...                                                         */
/*    ]                                                            */
/*                                                                   */
/*  Each game has:                                                   */
/*    - home_games / away_games: running cumulative score in the set  */
/*    - game_winner: 1 (home) or 2 (away)                            */
/*    - is_break: 1/2 (who broke), or null (no break)               */
/*    - server: 1/2 (who served)                                     */
/*    - point_sequence: tennis notation, e.g. "15:0, 30:0, 40:0 |B1|, 40:15" */
/*      - "A:40" = advantage for server                               */
/*      - "|B1|" / "|B2|" / "|B3|" = break point markers             */
/*                                                                   */
/*  Defensive: also tries common wrapper patterns                     */
/*  ({ data: [...], { result: [...] }, etc.) in case the API         */
/*  changes its top-level shape.                                     */
/* ================================================================== */

export function mapPointByPoint(payload: unknown): PointByPointData | null {
  if (!payload) return null;

  // Unwrap if response is wrapped (e.g., { data: [...] })
  let sets: any[] | null = null;
  if (Array.isArray(payload)) {
    sets = payload;
  } else if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["data", "result", "response", "payload", "items", "sets", "point_by_point"]) {
      if (Array.isArray(obj[key])) {
        sets = obj[key] as any[];
        break;
      }
      // Nested: { data: { sets: [...] } }
      if (obj[key] && typeof obj[key] === "object") {
        const inner = (obj[key] as any).sets ?? (obj[key] as any).data ?? (obj[key] as any).items;
        if (Array.isArray(inner)) {
          sets = inner;
          break;
        }
      }
    }
  }

  if (!Array.isArray(sets) || sets.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[flashscore-pbp] No sets array in payload. Type: ${typeof payload}, keys: ${payload && typeof payload === "object" ? Object.keys(payload).join(", ") : "(none)"}`
    );
    return null;
  }

  const out: PointByPointData = { sets: [] };

  sets.forEach((rawSet: any, setIndex: number) => {
    if (!rawSet || typeof rawSet !== "object") return;

    const setNumber =
      extractFirstNumber(rawSet, ["set_number", "setNumber", "number", "set"]) ??
      setIndex + 1; // fallback to 1-based position
    const setName =
      extractField<string>(rawSet, ["name", "set_name", "label", "title"]) ??
      `Set ${setNumber}`;

    const rawGames = Array.isArray(rawSet.games)
      ? rawSet.games
      : Array.isArray(rawSet.points)
        ? rawSet.points
        : Array.isArray(rawSet.events)
          ? rawSet.events
          : [];

    if (rawGames.length === 0) return;

    const games: PointByPointGame[] = [];
    for (const g of rawGames) {
      if (!g || typeof g !== "object") continue;
      const homeGames = extractFirstNumber(g, [
        "home_games", "homeGames", "home", "player1_games", "p1_games", "team1_games",
      ]);
      const awayGames = extractFirstNumber(g, [
        "away_games", "awayGames", "away", "player2_games", "p2_games", "team2_games",
      ]);
      if (homeGames === undefined || awayGames === undefined) continue;

      const gameWinnerRaw = extractField<unknown>(g, [
        "game_winner", "gameWinner", "winner",
      ]);
      const gameWinner: 1 | 2 | null =
        gameWinnerRaw === 1 || gameWinnerRaw === "1" || gameWinnerRaw === "home" || gameWinnerRaw === "home_team"
          ? 1
          : gameWinnerRaw === 2 || gameWinnerRaw === "2" || gameWinnerRaw === "away" || gameWinnerRaw === "away_team"
            ? 2
            : null;

      const isBreakRaw = extractField<unknown>(g, [
        "is_break", "isBreak", "break",
      ]);
      const isBreak: 1 | 2 | null =
        isBreakRaw === 1 || isBreakRaw === "1" || isBreakRaw === "home" ? 1 :
        isBreakRaw === 2 || isBreakRaw === "2" || isBreakRaw === "away" ? 2 :
        null;

      const serverRaw = extractField<unknown>(g, [
        "server", "server_team", "serving_team",
      ]);
      const server: 1 | 2 | null =
        serverRaw === 1 || serverRaw === "1" || serverRaw === "home" || serverRaw === "home_team" ? 1 :
        serverRaw === 2 || serverRaw === "2" || serverRaw === "away" || serverRaw === "away_team" ? 2 :
        null;

      const pointSequence = String(
        extractField<unknown>(g, [
          "point_sequence", "pointSequence", "points", "sequence", "points_sequence",
        ]) ?? ""
      );

      // Skip games with missing critical fields
      if (gameWinner === null || server === null) continue;

      games.push({
        homeGames,
        awayGames,
        gameWinner,
        isBreak,
        server,
        pointSequence,
      });
    }

    if (games.length > 0) {
      out.sets.push({ setNumber, name: setName, games });
    }
  });

  if (out.sets.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[flashscore-pbp] Parsed ${sets.length} set(s) but no valid games extracted. First set sample:`,
      JSON.stringify(sets[0]).slice(0, 300)
    );
    return null;
  }

  return out;
}
