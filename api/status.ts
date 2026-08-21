/**
 * Health check endpoint — verifies Google OAuth token is readable.
 * GET /api/status → { ok: true } hoặc 503 { ok: false, error }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseCreds } from "./lib/token.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    parseCreds(); // throws if missing or malformed
    return res.status(200).json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(503).json({ ok: false, error: msg });
  }
}
