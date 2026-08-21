/**
 * Vercel serverless — bridge giữa Tennis Report Hub và pipeline n8n.
 *   POST /api/matches  {sport, match, youtube_link} → 202 {row_index, status, tab}
 *   GET  /api/matches?tab=Tennis → {tab, rows}
 */
/// <reference types="node" />

import { buildMatchLabel } from "./lib/label";
import { appendRow, readTab } from "./lib/sheets";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "POST") {
      const { sport = "tennis", match, youtube_link } = req.body || {};
      if (!match) return res.status(400).json({ error: "Thiếu trường 'match'" });
      const tab = sport === "soccer" ? "Soccer" : "Tennis";
      const label = buildMatchLabel(String(sport), String(match));
      const rowIndex = await appendRow(tab, label, String(youtube_link || ""));
      return res.status(202).json({ row_index: rowIndex, status: "queued", tab });
    }

    if (req.method === "GET") {
      const tab = (req.query?.tab as string) === "Soccer" ? "Soccer" : "Tennis";
      const rows = await readTab(tab);
      return res.json({ tab, rows });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Lỗi không xác định" });
  }
}
