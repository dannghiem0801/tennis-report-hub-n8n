/**
 * Vercel serverless — submit/list matches via Google Sheets (pipeline bridge).
 *
 * POST /api/matches  { sport, match, youtube_link? }
 *   → appends row to Tennis or Soccer tab
 *   ← { row_index, status: "queued", tab }
 *
 * GET /api/matches?tab=Tennis
 *   ← { tab, rows: SheetRow[] }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildMatchLabel } from "./lib/label.js";
import { appendRow, readTab } from "./lib/sheets.js";

const TAB_MAP: Record<string, string> = {
  tennis: "Tennis",
  soccer: "Soccer",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    const { sport = "tennis", match, youtube_link = "" } = req.body ?? {};

    if (!match) {
      return res.status(400).json({ error: "Thiếu trường 'match'" });
    }

    const tab = TAB_MAP[sport] ?? "Tennis";
    const label = buildMatchLabel(sport, match);

    try {
      const rowIndex = await appendRow(tab, label, youtube_link);
      return res.status(202).json({ row_index: rowIndex, status: "queued", tab });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  }

  if (req.method === "GET") {
    const tab = (req.query.tab as string) || "Tennis";
    if (tab !== "Tennis" && tab !== "Soccer") {
      return res.status(400).json({ error: "tab phải là Tennis hoặc Soccer" });
    }
    try {
      const rows = await readTab(tab);
      return res.status(200).json({ tab, rows });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
