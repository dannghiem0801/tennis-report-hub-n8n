/**
 * PATCH /api/update-status — update Status cell in Google Sheets
 * Body: { tab: string, row_index: number, status: string }
 */
/**
 * PATCH /api/update-status — update Status cell in Google Sheets
 * Body: { tab: string, row_index: number, status: string }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAccessToken } from "./lib/token.js";

const SPREADSHEET_ID = "1Q1LWnF3DhE9xHovdgqWG09ir4fc8gNJ6lht-aj3KPm4";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { tab = "Tennis", row_index, status } = req.body ?? {};
  if (!row_index || !status) {
    return res.status(400).json({ error: "Thiếu row_index hoặc status" });
  }

  try {
    const { token } = await getAccessToken();
    const range = `${tab}!C${row_index}:C${row_index}`;
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}` +
      `?valueInputOption=USER_ENTERED`;
    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [[status]] }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Sheets API ${resp.status}: ${body.slice(0, 300)}`);
    }
    return res.status(200).json({ updated: true, row: row_index, status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
