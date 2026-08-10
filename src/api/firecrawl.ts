/**
 * Shared Firecrawl client used by:
 *
 *  - the tennis + football report pre-fetch (`generateReport` calls this
 *    with a sport-specific query set BEFORE the LLM call, so the model
 *    can cite sources from a typed `evidenceIdsUsed` array),
 *  - the legacy `web_search` / `scrape_url` tool executors in `llm.ts`
 *    when those tools are opted into by an external caller.
 *
 * The client intentionally returns typed errors, not the prose
 * failure instructions that the previous `runFirecrawlSearch` used to
 * embed. Model-facing prose never mentions Firecrawl failure modes -
 * the evidence contract treats an unavailable source as a missing
 * evidence ID, not as a sentence the model has to read.
 *
 * Behavior contract:
 *
 *  - Parse BOTH `data: Array<...>` (older shape) AND
 *    `data: { web, news, images }` (current shape). `news` is
 *    included as a secondary stream so a good match-report can come
 *    from a news outlet; `images` is dropped entirely.
 *  - Accept only HTTPS results. http:// and non-http schemes are
 *    filtered before they touch the LLM prompt.
 *  - Dedupe URLs (lower-cased host + path) so we don't fetch the
 *    same live blog twice from different queries.
 *  - Drop well-known ad / image hosts that aren't live blogs.
 *  - Run at most TWO queries sequentially. Stop early once
 *    `MAX_SOURCES` usable excerpts are in hand.
 *  - Keep at most `MAX_SOURCES` results total, each capped at
 *    `MAX_EXCERPT_CHARS`. If the search response already includes a
 *    usable markdown excerpt, we use it; otherwise we scrape the
 *    leading result to fill the gap.
 *  - Never log headers, credentials, full prompts, or source bodies.
 *    Logs include timing, result count, response shape, and error
 *    code only.
 */

import type { FootballMatch, Match, TennisMatch } from "@/types";

export const FIRECRAWL_MAX_SOURCES = 2;
export const FIRECRAWL_MAX_EXCERPT_CHARS = 1500;
const SEARCH_TIMEOUT_MS = 15_000;
const SCRAPE_TIMEOUT_MS = 25_000;
const SCRAPE_LEADING_RESULT_ONLY = true;

export type FirecrawlErrorCode =
  | "no_api_key"
  | "network"
  | "timeout"
  | "http"
  | "parse"
  | "malformed"
  | "no_results";

export class FirecrawlError extends Error {
  code: FirecrawlErrorCode;
  status?: number;
  constructor(message: string, code: FirecrawlErrorCode, status?: number) {
    super(message);
    this.name = "FirecrawlError";
    this.code = code;
    this.status = status;
  }
}

export interface FirecrawlSource {
  /** Stable evidence ID, e.g. `web-0` for the first pre-fetched source. */
  evidenceId: string;
  url: string;
  title: string;
  /** Trimmed excerpt (markdown). Empty when the search payload had
   *  no useful body and the leading scrape failed. */
  excerpt: string;
  /** Whether this source was obtained from a search snippet (true) or
   *  by scraping the leading result (false). */
  fromSnippet: boolean;
}

export interface FirecrawlFetchResult {
  sources: FirecrawlSource[];
  /** True when no usable source could be obtained. */
  empty: boolean;
  /** Stable reason code for observability. */
  reason: string;
  /** Redacted metrics for the safety pipeline. */
  metrics: {
    queriesExecuted: number;
    searchResultsParsed: number;
    scrapeAttempts: number;
    scrapeSuccesses: number;
  };
}

interface FirecrawlSearchRawItem {
  url?: string;
  title?: string;
  description?: string;
  markdown?: string;
  metadata?: { title?: string; description?: string; sourceURL?: string };
}

interface FirecrawlSearchResponse {
  success?: boolean;
  data?: unknown;
  error?: string;
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: { markdown?: string; metadata?: { title?: string } };
  error?: string;
}

/** Hosts that should never reach the LLM as live-blog content. */
const BLOCKED_HOSTS = new Set<string>([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "facebook.com",
  "www.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
]);

/** Normalize Firecrawl `/v2/search` `data` into a flat list. Handles
 *  both the older `{ data: Array<...> }` and current
 *  `{ data: { web: [...], news: [...] } }` shapes. Drops `images`
 *  and any entry we can't recognize. */
export function normalizeSearchResponse(payload: unknown): FirecrawlSearchRawItem[] {
  const resp = payload as FirecrawlSearchResponse | null | undefined;
  if (!resp || resp.success === false) return [];
  const data = resp.data;
  if (!data) return [];
  if (Array.isArray(data)) return data as FirecrawlSearchRawItem[];
  if (typeof data === "object") {
    const obj = data as { web?: unknown; news?: unknown };
    const web = Array.isArray(obj.web) ? (obj.web as FirecrawlSearchRawItem[]) : [];
    const news = Array.isArray(obj.news) ? (obj.news as FirecrawlSearchRawItem[]) : [];
    return [...web, ...news];
  }
  return [];
}

/** Keep only https:// URLs from a host we don't block. Returns the
 *  cleaned item or null when the entry is unusable. */
function cleanItem(item: FirecrawlSearchRawItem): FirecrawlSearchRawItem | null {
  const url = item.url || item.metadata?.sourceURL || "";
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (BLOCKED_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  return {
    ...item,
    url: parsed.toString(),
  };
}

/** Dedupe key for a URL - protocol-agnostic, trailing-slash agnostic. */
function dedupeKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

/** Cap a string at N chars, appending a benign truncation marker. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n\n[... truncated to ${max} chars ...]`;
}

/** Minimal polyfill for AbortSignal.any (Safari < 17.4). */
function anySignalPolyfill(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

// In dev, prefer the Vite proxy so the browser sees only localhost
// (no cross-origin request, no CORS preflight, no extension false-
// positives). On any non-2xx proxy response, fall back to calling
// Firecrawl directly: the upstream CORS headers are correct, so a
// direct browser call succeeds when the proxy path doesn't.
//
// `import.meta.env` is a Vite-only substitution. `import.meta.env?.DEV`
// evaluates to `true` under Vite and `undefined` under Node/tsx.
// Treat undefined as "not in a Vite build" → use the direct URL.
const IS_VITE_DEV = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    return env?.DEV === true;
  } catch {
    return false;
  }
})();
const SEARCH_URLS = IS_VITE_DEV
  ? ["/firecrawl-proxy/v2/search", "https://api.firecrawl.dev/v2/search"]
  : ["https://api.firecrawl.dev/v2/search"];
const SCRAPE_URLS = IS_VITE_DEV
  ? ["/firecrawl-proxy/v2/scrape", "https://api.firecrawl.dev/v2/scrape"]
  : ["https://api.firecrawl.dev/v2/scrape"];

/** Run a Firecrawl request, falling back from the dev proxy URL to
 *  the direct Firecrawl URL on any failure. Returns the first 2xx
 *  response; throws FirecrawlError on the last attempt's failure. */
async function firecrawlFetch(
  urls: string[],
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  let lastErr: unknown = null;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const composed = signal ? anySignalPolyfill([signal, controller.signal]) : controller.signal;
    try {
      const res = await fetch(url, { ...init, signal: composed });
      clearTimeout(timeoutId);
      if (res.ok) return res;
      // Keep the body so the caller can surface the upstream message,
      // but treat 4xx/5xx as a candidate for the next URL.
      const body = await res.text().catch(() => "");
      lastErr = new FirecrawlError(
        `HTTP ${res.status} from ${url}: ${body.slice(0, 200)}`,
        "http",
        res.status
      );
      // Only fall back on transient / proxy-class failures (403, 502, 503, 504).
      // 4xx other than 403 is most likely an upstream API error we
      // should surface directly, not retry against the other URL.
      if (res.status !== 403 && res.status < 500) {
        throw lastErr;
      }
      // eslint-disable-next-line no-console
      console.log(`[firecrawl] ${url} returned ${res.status}, trying fallback`);
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof FirecrawlError) throw e;
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new FirecrawlError("timeout", "timeout");
      }
      lastErr = new FirecrawlError(
        e instanceof Error ? e.message : String(e),
        "network"
      );
      // eslint-disable-next-line no-console
      console.log(`[firecrawl] ${url} network error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    }
  }
  throw lastErr instanceof FirecrawlError
    ? lastErr
    : new FirecrawlError("all urls failed", "network");
}

/** Firecrawl search POST. Throws FirecrawlError on any failure. */
async function firecrawlSearch(
  query: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<FirecrawlSearchRawItem[]> {
  const res = await firecrawlFetch(
    SEARCH_URLS,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, limit: 5, lang: "en" }),
    },
    SEARCH_TIMEOUT_MS,
    signal
  );
  const body = (await res.json()) as FirecrawlSearchResponse;
  return normalizeSearchResponse(body);
}

/** Firecrawl scrape POST. Throws FirecrawlError on any failure. */
async function firecrawlScrape(
  url: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string> {
  const res = await firecrawlFetch(
    SCRAPE_URLS,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
    },
    SCRAPE_TIMEOUT_MS,
    signal
  );
  const body = (await res.json()) as FirecrawlScrapeResponse;
  if (body.success === false) {
    throw new FirecrawlError(body.error || "scrape failed", "http");
  }
  return body.data?.markdown || "";
}

/** Pre-fetch up to FIRECRAWL_MAX_SOURCES references for a match.
 *  Returns an empty result with a reason when nothing useful came
 *  back. Never throws; instead returns a typed empty:true so the
 *  caller can decide what to do (fall back to API-only evidence). */
export async function fetchMatchSources(
  options: { apiKey: string; queries: string[]; signal?: AbortSignal }
): Promise<FirecrawlFetchResult> {
  const metrics = {
    queriesExecuted: 0,
    searchResultsParsed: 0,
    scrapeAttempts: 0,
    scrapeSuccesses: 0,
  };
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    return { sources: [], empty: true, reason: "no_api_key", metrics };
  }
  if (!Array.isArray(options.queries) || options.queries.length === 0) {
    return { sources: [], empty: true, reason: "no_queries", metrics };
  }

  const seenUrls = new Set<string>();
  const sources: FirecrawlSource[] = [];
  let lastReason = "no_results";

  for (const query of options.queries.slice(0, 2)) {
    if (sources.length >= FIRECRAWL_MAX_SOURCES) break;
    metrics.queriesExecuted += 1;
    const startedAt = Date.now();
    let raw: FirecrawlSearchRawItem[] = [];
    try {
      raw = await firecrawlSearch(query, apiKey, options.signal);
    } catch (e) {
      const code = e instanceof FirecrawlError ? e.code : "network";
      // eslint-disable-next-line no-console
      console.log(
        `[firecrawl] search failed code=${code} duration_ms=${Date.now() - startedAt}`
      );
      lastReason = `search_${code}`;
      continue;
    }
    metrics.searchResultsParsed += raw.length;
    // eslint-disable-next-line no-console
    console.log(
      `[firecrawl] search ok query_len=${query.length} results=${raw.length} duration_ms=${Date.now() - startedAt}`
    );

    for (const r of raw) {
      if (sources.length >= FIRECRAWL_MAX_SOURCES) break;
      const cleaned = cleanItem(r);
      if (!cleaned || !cleaned.url) continue;
      const key = dedupeKey(cleaned.url);
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);

      let excerpt = (cleaned.markdown || "").trim();
      let fromSnippet = false;
      if (excerpt.length >= 200) {
        fromSnippet = true;
      } else if (SCRAPE_LEADING_RESULT_ONLY) {
        // Scrape the leading result to fill the gap. Only one
        // scrape per item to keep the latency budget tight.
        metrics.scrapeAttempts += 1;
        try {
          const startedScrapeAt = Date.now();
          const md = await firecrawlScrape(cleaned.url, apiKey, options.signal);
          // eslint-disable-next-line no-console
          console.log(
            `[firecrawl] scrape ok url_host=${new URL(cleaned.url).hostname} chars=${md.length} duration_ms=${Date.now() - startedScrapeAt}`
          );
          if (md.length >= 200) {
            metrics.scrapeSuccesses += 1;
            excerpt = md;
          }
        } catch (e) {
          const code = e instanceof FirecrawlError ? e.code : "network";
          // eslint-disable-next-line no-console
          console.log(`[firecrawl] scrape failed code=${code}`);
          lastReason = `scrape_${code}`;
          continue;
        }
      } else {
        continue;
      }

      sources.push({
        evidenceId: `web-${sources.length}`,
        url: cleaned.url,
        title: cleaned.title || cleaned.metadata?.title || cleaned.url,
        excerpt: truncate(excerpt, FIRECRAWL_MAX_EXCERPT_CHARS),
        fromSnippet,
      });
    }
  }

  if (sources.length === 0) {
    return { sources, empty: true, reason: lastReason, metrics };
  }
  return { sources, empty: false, reason: "", metrics };
}

/** Build sport-specific queries. Centralized so tennis + football can
 *  evolve independently while sharing the same fetch+cap client. */
export function buildMatchQueries(match: Match): string[] {
  if (match.sport === "football") {
    const m = match as FootballMatch;
    return [
      `${m.home.name} vs ${m.away.name} minute by minute`,
      `${m.home.name} ${m.away.name} match report`,
    ];
  }
  if (match.sport === "tennis") {
    const t = match as TennisMatch;
    return [
      `${t.player1.fullName} ${t.player2.fullName} match report`,
      `${t.player1.fullName} ${t.player2.fullName} recap ${t.tournamentName}`,
    ];
  }
  return [];
}
