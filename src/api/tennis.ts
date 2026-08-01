/**
 * Tennis API client (RapidAPI — livescore6)
 *
 * Host: livescore6.p.rapidapi.com
 * Auth: X-RapidAPI-Key + X-RapidAPI-Host headers
 * Base path: /matches/v2
 *
 * Daily workflow (single call, returns everything for the day):
 *   GET /matches/v2/list-by-date?Category=tennis&Date=YYYYMMDD&Timezone=7
 *   Response: { Ts, Stages: [{ Sid, Snm, Cnm, Events: [...] }] }
 *   - Each "Stage" is a tournament; each "Event" is a match.
 *   - Doubles are mixed with singles; we filter at the mapper layer.
 *   - Tr1S1..Tr1S3 / Tr2S1..Tr2S3 are per-set games (string-encoded).
 *     A value of 10+ in either column indicates a super tiebreak.
 *   - Esd is the start timestamp in YYYYMMDDHHMMSS, in the timezone
 *     requested via the `Timezone=` query param (UTC+7 by default —
 *     not UTC). See parseCompactDateTime for the parse logic.
 *   - Ewt (1 or 2) marks the winner; Esid is the event status id
 *     (1=Not Started, 6=Full Time, 92+=Set 1/2/3 in progress).
 *
 * Timestamps: API gives YYYYMMDDHHMMSS in the requested timezone.
 * parseCompactDateTime tags the resulting Date with the matching
 * +HH:MM offset so that the display helpers (which format in
 * Asia/Ho_Chi_Minh) round-trip the raw value exactly.
 * Status: see STATUS_MAP in mapper.
 *
 * NOTE: Browser-direct integration. The RapidAPI key is sent from the
 * client in every request. Acceptable for personal/demo use. For
 * production, route through a server-side proxy to keep the key secret.
 *
 * Caching (to stay under per-minute caps):
 *   - List-by-date: 30 min TTL (matches the user's 30-min manual refresh
 *     cadence — polls every 30 min when at work, otherwise relies on
 *     cached data + manual refresh button). 30 min cache means a refresh
 *     within that window is free, and a manual refresh after 30 min is
 *     still 1 call. Aligns with 500 req/month budget at ~3-4 sessions/week.
 *   - In-flight dedup: concurrent calls for the same key share one request
 */

import type { TournamentCategory } from "@/types";
import { apiCache } from "./cache";

const API_HOST = "livescore6.p.rapidapi.com";
const API_BASE = `https://${API_HOST}/matches/v2`;

// TTL constants
const TTL = {
  listByDate: 30 * 60 * 1000, // 30 min — matches user's manual refresh cadence
} as const;

// In-flight request map for dedup
const inFlight = new Map<string, Promise<unknown>>();

export function clearApiCache(): void {
  apiCache.clear();
}

export class TennisApiError extends Error {
  status: number;
  code: "network" | "unauthorized" | "forbidden" | "rate_limited" | "not_found" | "bad_request" | "server" | "cors";
  constructor(message: string, status: number, code: TennisApiError["code"]) {
    super(message);
    this.name = "TennisApiError";
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/*  Types — livescore6 response shapes                                */
/* ------------------------------------------------------------------ */

export interface ApiPlayerRef {
  ID: string;
  Nm: string; // full name
  Abr?: string; // 2-3 letter abbreviation
}

export interface ApiEvent {
  Eid: string;
  /** Start timestamp, YYYYMMDDHHMMSS in UTC.
   *  Note: the API returns this as a JSON number (e.g. 20260731004500),
   *  not a string. The mapper coerces both shapes for forward-compat. */
  Esd: number | string;
  /** Team 1 (singles = 1 player, doubles = 2). */
  T1: ApiPlayerRef[];
  /** Team 2 (singles = 1 player, doubles = 2). */
  T2: ApiPlayerRef[];
  /** Per-set games for team 1. String-encoded. May be missing. */
  Tr1S1?: string;
  Tr1S2?: string;
  Tr1S3?: string;
  /** Per-set games for team 2. */
  Tr2S1?: string;
  Tr2S2?: string;
  Tr2S3?: string;
  /** Per-set tiebreak sub-score for team 1 (e.g. "7" in a 7-6(7-3) set).
   *  Only present when the set reached a tiebreak. */
  Tr1S1T?: string;
  Tr1S2T?: string;
  Tr1S3T?: string;
  /** Per-set tiebreak sub-score for team 2. */
  Tr2S1T?: string;
  Tr2S2T?: string;
  Tr2S3T?: string;
  /** Current period (set) score in games. 0-0 if set not started. */
  Tr1?: string;
  Tr2?: string;
  /** Winner team: 1 or 2. Undefined if not decided. */
  Ewt?: number;
  /** Period status text. "FT" = full time, "NS" = not started,
   *  "S1"/"S2"/"S3" = set N in progress, etc. */
  Eps: string;
  /** Event status id: 1 = not started, 6 = full time, 92+ = live set. */
  Esid: number;
  /** Event type. */
  Et?: number;
  /** Event priority. */
  Epr?: number;
  /** Event coverage. */
  Ecov?: number;
  /** Odds ids / metadata. We don't parse these for now. */
  EO?: number;
  EOX?: number;
  /** Player / period ids (sportradar-style). */
  Pids?: Record<string, string>;
  Pid?: number;
  Spid?: number;
  /** Streaming / TV media metadata. */
  Media?: Record<string, unknown>;
}

export interface ApiStage {
  /** Unique stage id (one per tournament instance). */
  Sid: string;
  /** Tournament name. */
  Snm: string;
  /** Tournament slug. */
  Scd?: string;
  /** Category display name (e.g. "ATP 500", "WTA 250", "ATP Challenger"). */
  Cnm: string;
  /** Category slug (e.g. "atp-500", "wta-250", "atp-challenger"). */
  CnmT?: string;
  /** Category short name. */
  Csnm?: string;
  /** Category code. */
  Ccd?: string;
  /** Coverage flag. */
  Scu?: number;
  /** All events for this stage. */
  Events: ApiEvent[];
}

export interface ApiMatchesResponse {
  /** Server timestamp (epoch seconds). */
  Ts: number;
  /** All tournaments active on the requested day. */
  Stages: ApiStage[];
}

/* ------------------------------------------------------------------ */
/*  Fetch wrapper                                                      */
/* ------------------------------------------------------------------ */

interface RequestOptions {
  apiKey: string;
  signal?: AbortSignal;
}

async function tennisFetch<T>(
  path: string,
  opts: RequestOptions
): Promise<T> {
  if (!opts.apiKey) {
    throw new TennisApiError(
      "RapidAPI key chưa được cấu hình. Vào Settings để nhập key.",
      0,
      "unauthorized"
    );
  }

  const url = `${API_BASE}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": opts.apiKey,
        "X-RapidAPI-Host": API_HOST,
      },
      signal: opts.signal,
    });
  } catch (e) {
    const isAbort = e instanceof DOMException && e.name === "AbortError";
    if (isAbort) throw new TennisApiError("Request đã bị huỷ.", 0, "network");
    throw new TennisApiError(
      "Không thể kết nối tới Tennis API. Kiểm tra mạng, hoặc có thể bị trình duyệt chặn CORS — hãy dùng Vite dev proxy.",
      0,
      "cors"
    );
  }

  if (res.status === 204) {
    return {} as T;
  }
  if (res.status === 401) {
    throw new TennisApiError(
      "API key không hợp lệ. Vào Settings kiểm tra lại RapidAPI key.",
      401,
      "unauthorized"
    );
  }
  if (res.status === 403) {
    throw new TennisApiError(
      "API key bị từ chối (403). Kiểm tra gói subscription trên RapidAPI.",
      403,
      "forbidden"
    );
  }
  if (res.status === 404) {
    throw new TennisApiError("Tài nguyên không tồn tại (404).", 404, "not_found");
  }
  if (res.status === 429) {
    throw new TennisApiError(
      "Vượt quá giới hạn request. Chờ 1 phút rồi thử lại.",
      429,
      "rate_limited"
    );
  }
  if (res.status >= 500) {
    throw new TennisApiError(
      `Tennis API lỗi máy chủ (${res.status}). Thử lại sau.`,
      res.status,
      "server"
    );
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.message || body?.error || "";
    } catch {
      /* ignore */
    }
    throw new TennisApiError(
      detail || `Yêu cầu thất bại (${res.status}).`,
      res.status,
      res.status === 400 ? "bad_request" : "server"
    );
  }

  return (await res.json()) as T;
}

/** Cached + in-flight-deduped wrapper around tennisFetch. */
async function cachedFetch<T>(
  cacheKey: string,
  ttlMs: number,
  path: string,
  opts: RequestOptions
): Promise<T> {
  const cached = apiCache.get<T>(cacheKey);
  if (cached) return cached;

  const existing = inFlight.get(cacheKey);
  if (existing) return existing as Promise<T>;

  const promise = tennisFetch<T>(path, opts)
    .then((data) => {
      apiCache.set(cacheKey, data, ttlMs);
      return data;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });

  inFlight.set(cacheKey, promise);
  return promise;
}

/* ------------------------------------------------------------------ */
/*  Date helpers                                                       */
/* ------------------------------------------------------------------ */

/** Convert YYYY-MM-DD to YYYYMMDD (the API's compact format). */
function dateToCompact(date: string): string {
  return date.replace(/-/g, "");
}

/** Parse YYYYMMDDHHMMSS to ISO 8601. Returns null on bad input.
 *  Accepts both string and number — the live API returns it as a number
 *  (e.g. 20260731004500), but other tennis providers use a string.
 *
 *  IMPORTANT: the API is called with `Timezone=7` (see getMatchesByDate
 *  below), which means Esd is the wall-clock time in UTC+7, NOT UTC.
 *  We tag the parsed Date with `+07:00` so that display helpers (which
 *  format in Asia/Ho_Chi_Minh) round-trip the value exactly — i.e. the
 *  raw "14:30" from the API shows as "14:30" in the UI.
 *
 *  If you ever change the API call to a different timezone, update
 *  API_TIMEZONE_OFFSET below to match. */
const API_TIMEZONE_OFFSET = "+07:00";

function parseCompactDateTime(s: number | string | undefined | null): string | null {
  if (s === null || s === undefined) return null;
  const str = typeof s === "string" ? s : String(s);
  if (!str || str.length < 8) return null;
  const y = str.slice(0, 4);
  const mo = str.slice(4, 6);
  const d = str.slice(6, 8);
  const h = str.length >= 10 ? str.slice(8, 10) : "00";
  const mi = str.length >= 12 ? str.slice(10, 12) : "00";
  const se = str.length >= 14 ? str.slice(12, 14) : "00";
  // Interpret in the API's requested timezone (UTC+7 by default — must
  // mirror the `Timezone=` query param in getMatchesByDate).
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}${API_TIMEZONE_OFFSET}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface GetMatchesOptions extends RequestOptions {
  /** Date in YYYY-MM-DD. */
  date: string;
  /** Timezone offset from UTC, in hours. Defaults to 7 (Vietnam). */
  timezone?: number;
}

/**
 * Fetch all tennis matches for a single date. Returns the full
 * /list-by-date payload (stages + events) — the caller/mapper is
 * responsible for flattening into matches and tournaments.
 *
 * Cached 30 min, in-flight deduped.
 */
export async function getMatchesByDate(
  opts: GetMatchesOptions
): Promise<ApiMatchesResponse> {
  const compact = dateToCompact(opts.date);
  const tz = opts.timezone ?? 7;
  return cachedFetch<ApiMatchesResponse>(
    `livescore:listByDate:tennis:${compact}:tz${tz}`,
    TTL.listByDate,
    `/list-by-date?Category=tennis&Date=${compact}&Timezone=${tz}`,
    opts
  );
}

/* ------------------------------------------------------------------ */
/*  Tournament category inference                                      */
/* ------------------------------------------------------------------ */

const CATEGORY_MAP: Record<string, TournamentCategory> = {
  "Grand Slam": "Grand Slam",
  "ATP 1000": "ATP Masters 1000",
  "ATP Masters 1000": "ATP Masters 1000",
  "Masters 1000": "ATP Masters 1000",
  "ATP 500": "ATP 500",
  "ATP 250": "ATP 250",
  "WTA 1000": "WTA 1000",
  "WTA 500": "WTA 500",
  "WTA 250": "WTA 250",
  "ATP Challenger": "Challenger",
  "WTA Challenger": "Challenger",
  "ITF Men": "ITF",
  "ITF Women": "ITF",
  "UTR Men": "ITF",
  "UTR Women": "ITF",
  "WTA 125": "WTA 250", // approximate
};

export function categoryFromStage(stage: ApiStage): TournamentCategory {
  const cnm = stage.Cnm?.trim() ?? "";
  if (CATEGORY_MAP[cnm]) return CATEGORY_MAP[cnm];
  // Best-effort fallbacks
  if (cnm.startsWith("ATP 1000") || cnm.includes("Masters 1000")) return "ATP Masters 1000";
  if (cnm.startsWith("ATP 500")) return "ATP 500";
  if (cnm.startsWith("ATP 250")) return "ATP 250";
  if (cnm.startsWith("WTA 1000")) return "WTA 1000";
  if (cnm.startsWith("WTA 500")) return "WTA 500";
  if (cnm.startsWith("WTA 250")) return "WTA 250";
  if (cnm.includes("Challenger")) return "Challenger";
  if (cnm.includes("ITF") || cnm.includes("UTR")) return "ITF";
  if (cnm.startsWith("ATP")) return "ATP 250";
  if (cnm.startsWith("WTA")) return "WTA 250";
  return "ATP 250";
}

export { parseCompactDateTime };
