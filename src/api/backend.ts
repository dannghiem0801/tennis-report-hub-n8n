/**
 * Client-side API bridge — calls Vercel serverless endpoints.
 * VITE_API_BASE is injected at build time; falls back to relative path
 * so it works both on the deployed app and in local dev proxy.
 */

import type { SubmitPayload } from "@/lib/submit-payload";

const BASE = (import.meta.env?.VITE_API_BASE as string | undefined) ?? "";

export interface MatchRow {
  row_index: number;
  Match?: string;
  "Link Youtube"?: string;
  Status?: string;
  Report?: string;
  "Link Google Drive(youtube-to-drive)"?: string;
}

/** POST /api/matches — submit a completed match to the pipeline. */
export async function submitMatch(payload: SubmitPayload): Promise<{ row_index: number; status: string; tab: string }> {
  const res = await fetch(`${BASE}/api/matches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ row_index: number; status: string; tab: string }>;
}

/** GET /api/matches?tab=Tennis — read pipeline rows from the sheet. */
export async function getMatches(tab: string = "Tennis"): Promise<MatchRow[]> {
  const res = await fetch(`${BASE}/api/matches?tab=${encodeURIComponent(tab)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { rows: MatchRow[] };
  return data.rows ?? [];
}

/** Extract report text from a sheet row. */
export function getReportFromRow(row: MatchRow): string {
  return row.Report ?? "";
}

/** Extract Drive link from a sheet row. */
export function getDriveLinkFromRow(row: MatchRow): string {
  return row["Link Google Drive(youtube-to-drive)"] ?? "";
}
