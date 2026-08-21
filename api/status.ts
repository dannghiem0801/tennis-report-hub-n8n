/**
 * Vercel serverless — health check cho pipeline bridge.
 * Trả ok=true nếu GOOGLE_TOKEN_JSON được cấu hình và parse được.
 */
/// <reference types="node" />

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const raw = process.env.GOOGLE_TOKEN_JSON;
    if (!raw) return res.status(200).json({ ok: false, error: "GOOGLE_TOKEN_JSON chưa cấu hình" });
    JSON.parse(raw); // validate
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: e?.message || "invalid token json" });
  }
}
