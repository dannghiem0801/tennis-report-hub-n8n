/**
 * Thin wrapper around the shared Firecrawl client that preserves the
 * `FootballScrapedSource` shape the rest of the app already expects.
 * The new client (`./firecrawl.ts`) handles the unified search+scrape
 * pipeline with HTTPS-only filtering, dedupe, and per-source char cap.
 */

import type { FootballMatch } from "@/types";
import { buildMatchQueries, fetchMatchSources } from "./firecrawl";

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

export async function fetchFootballSources(
  match: FootballMatch,
  options?: { apiKey?: string; signal?: AbortSignal }
): Promise<FootballSourceResult> {
  const queries = buildMatchQueries(match);
  const result = await fetchMatchSources({
    apiKey: options?.apiKey ?? "",
    queries,
    signal: options?.signal,
  });
  return {
    queries,
    scraped: result.sources.map((s) => ({
      url: s.url,
      title: s.title,
      content: s.excerpt,
    })),
    empty: result.empty,
    reason: result.reason,
  };
}

/** Format the fetched sources as a markdown block to append to the LLM
 *  prompt. The LLM sees the rendered content and synthesizes from it. */
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
