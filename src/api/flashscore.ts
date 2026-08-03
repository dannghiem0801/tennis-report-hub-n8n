/**
 * FlashScore4 API client (RapidAPI)
 *
 * Host: flashscore4.p.rapidapi.com
 * Auth: X-Rapidapi-Key + X-Rapidapi-Host headers
 * Base path: /api/flashscore/v2
 *
 * Daily workflow (single call, returns everything for the day):
 *   GET /matches/list-by-date?sport_id=2&date=YYYY-MM-DD&timezone=Asia%2FBangkok
 *     - sport_id: 1=Football, 2=Tennis, 3=Basketball (see /get-sports for full list)
 *     - date: ISO date YYYY-MM-DD
 *     - timezone: IANA name (e.g. "Asia/Ho_Chi_Minh"), URL-encoded by the caller
 *
 * Per-match details (for completed matches, fills in set scores + stats that
 * list-by-date doesn't expose):
 *   GET /matches/details?match_id=<id>
 *
 * Response shape: TBD — the mapper is defensive and handles multiple common
 * patterns (flat array, { data }, { matches }, { stages/events }). Paste a
 * real response into src/api/flashscore-mapper.ts to refine field paths.
 *
 * Caching (to stay under per-day/per-minute caps):
 *   - List-by-date: 30 min TTL (matches the user's manual refresh cadence)
 *   - Match details: 7 d TTL (result is immutable once match is completed —
 *     safe to cache for a long time, and saves quota on report generation)
 *   - In-flight dedup: concurrent calls for the same key share one request
 *
 * RapidAPI FlashScore4 limits (current subscription):
 *   - 1,000 requests / day (hard limit)
 *   - 90 requests / minute (rate limit, returns 429)
 *   - 10,240 MB / month (bandwidth, ~340 MB/day — not a concern for PBP)
 */

import { apiCache } from "./cache";

const API_HOST = "flashscore4.p.rapidapi.com";
const API_BASE = `https://${API_HOST}/api/flashscore/v2`;

// TTL constants
const TTL = {
  listByDate: 30 * 60 * 1000, // 30 min
  // Match details (per-set game scores + stats). 7-day cache is safe
  // because the data is fully immutable once a match reaches "completed"
  // status — final score, tiebreak scores, aces, etc. never change. This
  // keeps the 1,000 req/day budget under control: a 10-match day hits
  // localStorage for the next 7 days instead of re-fetching each time.
  matchDetails: 7 * 24 * 60 * 60 * 1000, // 7 days
  // Point-by-point data — fetched lazily per watchlist add. 7-day cache
  // for the same reason (immutable). Response is large (10-50 KB per
  // match), so caching aggressively keeps localStorage under control.
  pointByPoint: 7 * 24 * 60 * 60 * 1000, // 7 days
} as const;

// In-flight request map for dedup
const inFlight = new Map<string, Promise<unknown>>();

// Negative cache: when a fetch returns 429, remember the cooldown per
// cache key for 60s. Subsequent calls within the window throw the same
// error without hitting the network — prevents a 20-match parallel
// fan-out from hammering the API after the first 429.
//
// Lives in-memory only (cleared on page refresh) — short-lived by design.
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const rateLimitedUntil = new Map<string, number>();

// Global rate-limit listener. The app store registers a callback so
// that a 429 from any caller (list-by-date, details, PBP) pauses the
// dashboard polling, manual refresh, and per-match detail/PBP effects
// for the cooldown window. Without this, only fetchMatches was wired
// to set rateLimitUntil, so details/PBP 429s slipped through and the
// next match kept hammering the API.
type RateLimitedListener = (until: Date) => void;
let rateLimitedListener: RateLimitedListener | null = null;
export function setRateLimitedListener(listener: RateLimitedListener | null): void {
  rateLimitedListener = listener;
}

export class FlashscoreApiError extends Error {
  status: number;
  code: "network" | "unauthorized" | "forbidden" | "rate_limited" | "not_found" | "bad_request" | "server" | "cors";
  constructor(message: string, status: number, code: FlashscoreApiError["code"]) {
    super(message);
    this.name = "FlashscoreApiError";
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/*  Fetch wrapper                                                      */
/* ------------------------------------------------------------------ */

interface RequestOptions {
  apiKey: string;
  signal?: AbortSignal;
}

async function fsFetch<T>(
  path: string,
  opts: RequestOptions
): Promise<T> {
  if (!opts.apiKey) {
    throw new FlashscoreApiError(
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
        "X-Rapidapi-Key": opts.apiKey,
        "X-Rapidapi-Host": API_HOST,
      },
      signal: opts.signal,
    });
  } catch (e) {
    const isAbort = e instanceof DOMException && e.name === "AbortError";
    if (isAbort) throw new FlashscoreApiError("Request đã bị huỷ.", 0, "network");
    throw new FlashscoreApiError(
      "Không thể kết nối tới FlashScore API. Kiểm tra mạng, hoặc có thể bị trình duyệt chặn CORS — hãy dùng Vite dev proxy.",
      0,
      "cors"
    );
  }

  if (res.status === 204) {
    return {} as T;
  }
  if (res.status === 401) {
    throw new FlashscoreApiError(
      "API key không hợp lệ. Vào Settings kiểm tra lại RapidAPI key.",
      401,
      "unauthorized"
    );
  }
  if (res.status === 403) {
    throw new FlashscoreApiError(
      "API key bị từ chối (403). Kiểm tra gói subscription trên RapidAPI.",
      403,
      "forbidden"
    );
  }
  if (res.status === 404) {
    throw new FlashscoreApiError("Tài nguyên không tồn tại (404).", 404, "not_found");
  }
  if (res.status === 429) {
    throw new FlashscoreApiError(
      "Vượt quá giới hạn request. Chờ 1 phút rồi thử lại.",
      429,
      "rate_limited"
    );
  }
  if (res.status >= 500) {
    throw new FlashscoreApiError(
      `FlashScore API lỗi máy chủ (${res.status}). Thử lại sau.`,
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
    throw new FlashscoreApiError(
      detail || `Yêu cầu thất bại (${res.status}).`,
      res.status,
      res.status === 400 ? "bad_request" : "server"
    );
  }

  return (await res.json()) as T;
}

/** Cached + in-flight-deduped wrapper around fsFetch. */
async function cachedFetch<T>(
  cacheKey: string,
  ttlMs: number,
  path: string,
  opts: RequestOptions
): Promise<T> {
  // Positive cache hit
  const cached = apiCache.get<T>(cacheKey);
  if (cached) return cached;

  // Negative cache hit (still in 429 cooldown from a prior failed fetch)
  const rlUntil = rateLimitedUntil.get(cacheKey);
  if (rlUntil && Date.now() < rlUntil) {
    throw new FlashscoreApiError(
      "Vượt quá giới hạn request (cached — sẽ thử lại sau 60s).",
      429,
      "rate_limited"
    );
  }

  // In-flight dedup
  const existing = inFlight.get(cacheKey);
  if (existing) return existing as Promise<T>;

  const promise = fsFetch<T>(path, opts)
    .then((data) => {
      apiCache.set(cacheKey, data, ttlMs);
      rateLimitedUntil.delete(cacheKey);
      return data;
    })
    .catch((err) => {
      // Negative cache on 429 so parallel/concurrent calls don't
      // keep hitting the API within the cooldown window. Also notify
      // the global rate-limit listener (if registered) so the app
      // store can pause other fetches.
      if (err instanceof FlashscoreApiError && err.code === "rate_limited") {
        const until = new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS);
        rateLimitedUntil.set(cacheKey, until.getTime());
        rateLimitedListener?.(until);
      }
      throw err;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });

  inFlight.set(cacheKey, promise);
  return promise;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface GetMatchesOptions extends RequestOptions {
  /** sport_id (1=Football, 2=Tennis, 3=Basketball). */
  sportId: number;
  /** Date in YYYY-MM-DD (ISO). */
  date: string;
  /** IANA timezone name, e.g. "Asia/Ho_Chi_Minh". Will be URL-encoded. */
  timezone: string;
}

/**
 * Fetch all matches for a single (sport, date) tuple. Returns the raw
 * /list-by-date payload — the caller/mapper is responsible for
 * flattening into matches and tournaments.
 *
 * Cached 30 min, in-flight deduped.
 *
 * NOTE: response shape is unknown until a real sample is captured.
 * Mapper handles multiple common patterns defensively.
 */
export async function getMatchesByDate(
  opts: GetMatchesOptions
): Promise<unknown> {
  const tz = encodeURIComponent(opts.timezone);
  return cachedFetch<unknown>(
    `flashscore:listByDate:sport${opts.sportId}:${opts.date}:tz${opts.timezone}`,
    TTL.listByDate,
    `/matches/list-by-date?sport_id=${opts.sportId}&date=${opts.date}&timezone=${tz}`,
    opts
  );
}

/**
 * Fetch full details for a single match (set-by-set scores, stats, winner).
 * Use this for completed matches to enrich the report with data that
 * list-by-date doesn't expose (it only gives sets won, not per-set games).
 *
 * Cached 24 h (results are immutable once the match is over — saves quota
 * when reports are regenerated or the dashboard re-renders).
 *
 * NOTE: response shape is unknown until a real sample is captured.
 * Mapper handles multiple common patterns defensively.
 */
export interface GetMatchDetailsOptions extends RequestOptions {
  matchId: string;
}

export async function getMatchDetails(
  opts: GetMatchDetailsOptions
): Promise<unknown> {
  return cachedFetch<unknown>(
    `flashscore:matchDetails:${opts.matchId}`,
    TTL.matchDetails,
    `/matches/details?match_id=${encodeURIComponent(opts.matchId)}`,
    opts
  );
}

/**
 * Fetch point-by-point data for a single match. Each set contains an
 * ordered array of games with running score, server, break indicator,
 * and a tennis point-sequence string. Used to enrich the LLM report
 * with detailed play-by-play (breaks, deuces, long games).
 *
 * **Lazy fetch strategy** (see app-store.tsx):
 *   - Only triggered when a match is added to the watchlist (not for
 *     every completed match on the dashboard — that would waste the
 *     1,000 req/day budget).
 *   - 7-day cache (immutable data) so the same match never re-fetches.
 *
 * Cached 7 days, in-flight deduped.
 */
export interface GetPointByPointOptions extends RequestOptions {
  matchId: string;
}

export async function getPointByPoint(
  opts: GetPointByPointOptions
): Promise<unknown> {
  return cachedFetch<unknown>(
    `flashscore:pointByPoint:${opts.matchId}`,
    TTL.pointByPoint,
    `/matches/match/point-by-point?match_id=${encodeURIComponent(opts.matchId)}`,
    opts
  );
}

/** Clear all cached API responses. Use when switching keys or
 *  troubleshooting stale data. */
export function clearApiCache(): void {
  apiCache.clear();
  inFlight.clear();
  rateLimitedUntil.clear();
}
