/**
 * App-side pre-fetch of football match sources (live blog / match report)
 * via Firecrawl. Runs BEFORE the LLM call so the LLM has verified
 * sources to synthesize from — instead of having to call tools itself
 * (which the MiniMax-M3 model is unreliable at: it tends to output
 * tool calls as text instead of proper `tool_use` blocks).
 *
 * Flow:
 *   1. Search Firecrawl `/v2/search` with 2-3 query variants
 *      (minute-by-minute, as-it-happened, match report)
 *   2. Pick top 1-2 unique URLs
 *   3. Scrape each with `/v2/scrape` (JS rendering)
 *   4. Return formatted markdown to append to the LLM prompt
 *
 * Failure modes (all non-fatal — caller falls back to data-only):
 *   - Firecrawl API key not configured → empty result
 *   - Search returns no results (future match, very old match, backend
 *     outage) → empty result
 *   - Scrape fails for a URL → skip that URL, try next
 *
 * The caller (generate.ts) appends the formatted result to the LLM
 * prompt. If the result is empty, the LLM just gets the system data
 * (the "Trường hợp 1" fallback from the journalist prompt).
 */

import type { FootballMatch } from "@/types";
import { env } from "@/lib/env";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const MAX_SOURCES = 2; // cap at 2 scraped sources per match
const SCRAPE_TIMEOUT_MS = 25_000;
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_CONTENT_CHARS = 8_000; // cap per scraped page

export interface FootballScrapedSource {
  url: string;
  title: string;
  content: string;
}

export interface FootballSourceResult {
  queries: string[];
  scraped: FootballScrapedSource[];
  /** Empty when no sources found. The LLM should fall back to system data. */
  empty: boolean;
  /** Reason for empty (for debug logs). */
  reason: string;
}

interface FirecrawlSearchResponse {
  success?: boolean;
  /**
   * Firecrawl `/v2/search` returns `data` as an OBJECT with sub-arrays
   * (e.g. `{ web: [...], news: [...], images: [...] }`), not as a flat
   * array. We always pull from `data.web` — the standard web results.
   * If the upstream shape changes, `normalizeSearchResults()` adapts.
   */
  data?:
    | Array<{ url?: string; title?: string; markdown?: string }>
    | { web?: Array<{ url?: string; title?: string; markdown?: string }>; news?: unknown[]; images?: unknown[] };
  warning?: string;
  error?: string;
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: { markdown?: string; metadata?: { title?: string } };
  error?: string;
}

async function firecrawlSearch(query: string, apiKey: string): Promise<FirecrawlSearchResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(FIRECRAWL_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, limit: 4, lang: "en" }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return (await res.json()) as FirecrawlSearchResponse;
  } catch (e) {
    clearTimeout(timeoutId);
    return { error: e instanceof Error ? e.message : "network" };
  }
}

/**
 * Normalize Firecrawl `/v2/search` response to a flat array of results.
 * Upstream returns either:
 *   - `{ data: [...] }` (older / alternate shape)
 *   - `{ data: { web: [...], news: [...], images: [...] } }` (current shape)
 * We always pull from `data.web` when nested; falls back to the array
 * itself for the flat shape. Returns [] on any unrecognized shape.
 */
function normalizeSearchResults(data: FirecrawlSearchResponse["data"]): Array<{ url?: string; title?: string; markdown?: string }> {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && Array.isArray(data.web)) return data.web;
  return [];
}

async function firecrawlScrape(url: string, apiKey: string): Promise<FirecrawlScrapeResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return (await res.json()) as FirecrawlScrapeResponse;
  } catch (e) {
    clearTimeout(timeoutId);
    return { error: e instanceof Error ? e.message : "network" };
  }
}

/**
 * Pre-fetch live blogs / match reports for a football match via Firecrawl.
 * Returns up to MAX_SOURCES scraped pages, each capped at MAX_CONTENT_CHARS.
 * On any failure, returns an empty result (caller should treat as
 * "fall back to system data" path).
 */
export async function fetchFootballSources(match: FootballMatch): Promise<FootballSourceResult> {
  const apiKey = env.search.apiKey();
  if (!apiKey) {
    return { queries: [], scraped: [], empty: true, reason: "no Firecrawl API key" };
  }

  const home = match.home.name;
  const away = match.away.name;
  const dateStr = new Date(match.startTime).toISOString().slice(0, 10);

  // Try a few query variants — different sources return different things
  const queries = [
    `${home} vs ${away} minute by minute`,
    `${home} ${away} as it happened`,
    `${home} ${away} match report ${dateStr}`,
  ];

  const seen = new Set<string>();
  const scraped: FootballScrapedSource[] = [];

  for (const query of queries) {
    if (scraped.length >= MAX_SOURCES) break;
    // eslint-disable-next-line no-console
    console.log(`[football-sources] search: "${query}"`);

    const search = await firecrawlSearch(query, apiKey);
    if (search.error) {
      // eslint-disable-next-line no-console
      console.log(`[football-sources] search failed: ${search.error}`);
      continue;
    }
    const results = normalizeSearchResults(search.data);
    if (results.length === 0) {
      // eslint-disable-next-line no-console
      console.log(`[football-sources] search returned 0 results for "${query}"`);
      continue;
    }

    for (const r of results) {
      if (scraped.length >= MAX_SOURCES) break;
      if (!r.url || seen.has(r.url)) continue;
      // Skip domains that are unlikely to have live blogs
      if (r.url.includes("youtube.com") || r.url.includes("twitter.com") || r.url.includes("x.com")) continue;
      seen.add(r.url);

      // eslint-disable-next-line no-console
      console.log(`[football-sources] scrape: ${r.url}`);
      const scrape = await firecrawlScrape(r.url, apiKey);
      if (scrape.error || !scrape.data?.markdown) {
        // eslint-disable-next-line no-console
        console.log(`[football-sources] scrape failed: ${scrape.error ?? "no markdown"}`);
        continue;
      }
      const content = scrape.data.markdown;
      if (content.length < 200) {
        // eslint-disable-next-line no-console
        console.log(`[football-sources] scrape too short (${content.length} chars), skip`);
        continue;
      }
      scraped.push({
        url: r.url,
        title: scrape.data.metadata?.title ?? r.title ?? r.url,
        content: content.slice(0, MAX_CONTENT_CHARS),
      });
    }
  }

  if (scraped.length === 0) {
    return { queries, scraped: [], empty: true, reason: "no live blogs found" };
  }
  return { queries, scraped, empty: false, reason: "" };
}

/**
 * Format the fetched sources as a markdown block to append to the LLM
 * prompt. The LLM sees the rendered content and synthesizes from it.
 */
export function formatFootballSources(result: FootballSourceResult): string {
  if (result.empty) {
    return [
      "",
      "# Nguồn tham khảo từ web",
      "",
      `Không tìm thấy live blog / match report cho trận này (${result.reason}).`,
      "Có thể là trận tương lai, trận cũ, hoặc search backend tạm lỗi.",
      "Hãy viết bản tin dựa trên dữ liệu hệ thống ở trên (phút ghi bàn, stats, đội hình).",
      "",
    ].join("\n");
  }

  const parts = ["", "# Nguồn tham khảo từ web (đã scrape tự động trước khi gọi LLM)", ""];
  parts.push(`Đã search với ${result.queries.length} query và scrape ${result.scraped.length} nguồn:`);
  for (let i = 0; i < result.scraped.length; i++) {
    const s = result.scraped[i];
    parts.push(`\n## Nguồn ${i + 1}: ${s.title}`);
    parts.push(`URL: ${s.url}\n`);
    parts.push(s.content);
  }
  parts.push("");
  return parts.join("\n");
}
