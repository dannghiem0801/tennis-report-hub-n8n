/**
 * Browser-side caller for the narrow server-side RapidAPI MCP bridge.
 *
 * The browser never receives the MCP URL, routing headers, or subscription
 * key. It merely asks our same-origin endpoint for a small, deterministic set
 * of missing fields. Failure is intentionally soft: the existing API-only
 * report remains a valid fallback when MCP is disabled or unavailable.
 */

import type { Match } from "@/types";
import type { McpEvidence } from "./evidence";

const ENRICHMENT_URL = "/api/mcp/enrich";
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_AUTOMATIC_CALLS = 2;

export interface McpToolRequest {
  name: string;
  arguments: { match_id: string };
}

interface EnrichmentResponse {
  results?: Array<{
    evidenceId?: unknown;
    toolName?: unknown;
    fetchedAt?: unknown;
    verified?: unknown;
    content?: unknown;
  }>;
}

function hasUsableContent(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length > 0 && trimmed !== "[]" && trimmed !== "{}" && trimmed !== "null";
}

/**
 * Select the smallest useful data recovery set. Tool names are the FlashScore
 * MCP names configured in RAPID_MCP_ALLOWED_TOOLS; callers never choose
 * arbitrary MCP tools. A report starts only after a completed match, but the
 * status guard prevents accidental enrichment for live/scheduled previews.
 */
export function selectMcpRequests(match: Match): McpToolRequest[] {
  if (match.status !== "completed" || !match.id) return [];

  const requests: McpToolRequest[] = [];
  const add = (name: string) => {
    if (requests.length < MAX_AUTOMATIC_CALLS) {
      requests.push({ name, arguments: { match_id: match.id } });
    }
  };

  // Missing final-score detail is most important for a publishable recap.
  if (match.sport === "tennis" && (!match.sets || match.sets.length === 0)) {
    add("Get_Match_Details");
  }
  if (match.sport === "football" && !match.finalScore) {
    add("Get_Match_Details");
  }

  if (!match.stats) add("Get_Match_Stats");
  if (match.sport === "tennis" && !match.pointByPoint?.sets.length) {
    add("Get_Match_Point_by_Point");
  }
  return requests;
}

export async function fetchMcpEvidence(
  match: Match,
  options?: { signal?: AbortSignal }
): Promise<McpEvidence[]> {
  // `generateReport` is also used by Node-based operational scripts. Those
  // scripts do not have a same-origin Vercel function, so keep their existing
  // deterministic evidence path untouched.
  if (typeof window === "undefined") return [];

  const requests = selectMcpRequests(match);
  if (requests.length === 0) return [];

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(ENRICHMENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const payload = await response.json() as EnrichmentResponse;
    if (!Array.isArray(payload.results)) return [];

    return payload.results.flatMap((result): McpEvidence[] => {
      if (
        result.verified !== true ||
        typeof result.evidenceId !== "string" ||
        typeof result.toolName !== "string" ||
        typeof result.fetchedAt !== "string" ||
        typeof result.content !== "string" ||
        !hasUsableContent(result.content)
      ) {
        return [];
      }
      return [{
        evidenceId: result.evidenceId,
        toolName: result.toolName,
        fetchedAt: result.fetchedAt,
        content: result.content,
      }];
    });
  } catch {
    return [];
  } finally {
    window.clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", onAbort);
  }
}
