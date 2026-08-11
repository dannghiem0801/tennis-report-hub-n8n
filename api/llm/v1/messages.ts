/**
 * Vercel serverless function — Anthropic-compatible LLM proxy.
 *
 * Mounted at `/api/llm/v1/messages` via Vercel's file-based routing
 * (specific file path, no rewrite needed).
 *
 * Why this exists:
 *   Browsers can't call `https://api.minimax.io/anthropic/v1/messages`
 *   directly — that origin doesn't send `Access-Control-Allow-Origin`
 *   for our deployed domain, so the browser blocks the response as a
 *   CORS error before the LLM can answer. Same problem we hit with
 *   Flashscore; same fix (compare `api/flashscore-handler.ts`).
 *
 *   In dev, the Vite dev server already proxies `/llm-proxy/*` to the
 *   upstream (see `vite.config.ts`) so this function is irrelevant
 *   there. In production, the browser calls `/api/llm/v1/messages`
 *   (same-origin) and this function forwards to the upstream.
 *
 * Env vars (server-side only):
 *   - `LLM_API_KEY` — Anthropic-compatible API key. Server-side only;
 *     never expose it through a `VITE_` variable.
 *   - `VITE_LLM_API_KEY` — legacy fallback only. Remove it after
 *     migrating the Vercel project to `LLM_API_KEY`.
 *   - `LLM_UPSTREAM_BASE` — optional. Default `https://api.minimax.io/anthropic`.
 *     Override if you point at a different Anthropic-compatible proxy.
 *   - `LLM_UPSTREAM_API_VERSION` — optional. Default `2023-06-01`.
 *
 * Streaming:
 *   The upstream call is non-streaming (await + send body). The
 *   browser-side `callLLM` in `src/api/llm.ts` does multi-turn
 *   tool-call loops with non-streaming responses, so this is enough
 *   for v1.5. If a future flow needs SSE streaming, flip
 *   `ANTHROPIC_STREAM` handling here.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

const ANTHROPIC_API_VERSION = process.env.LLM_UPSTREAM_API_VERSION ?? "2023-06-01";
const DEFAULT_UPSTREAM_BASE = "https://api.minimax.io/anthropic";
// Leave a small margin below Vercel's 300s function limit. The browser uses
// the same 300s ceiling, so the proxy can return a meaningful 504 itself.
const DEFAULT_TIMEOUT_MS = 270_000;

function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-api-key, anthropic-version"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed; use POST" });
    return;
  }

  // Prefer the server-only credential. The VITE_ fallback keeps current
  // deployments working while the project variable is migrated.
  const apiKey = process.env.LLM_API_KEY ?? process.env.VITE_LLM_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "Server misconfigured: LLM_API_KEY is not set",
    });
    return;
  }

  const upstreamBase = (process.env.LLM_UPSTREAM_BASE ?? DEFAULT_UPSTREAM_BASE)
    .trim()
    .replace(/\/+$/, "");
  const upstreamUrl = `${upstreamBase}/v1/messages`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();
  const requestId = `llm-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;

  try {
    // eslint-disable-next-line no-console
    console.log(
      `[api/llm] [${requestId}] → POST ${upstreamUrl} ` +
        `body=${typeof req.body === "string" ? req.body.length : JSON.stringify(req.body ?? {}).length}chars ` +
        `timeout=${DEFAULT_TIMEOUT_MS / 1000}s`
    );

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const durationMs = Date.now() - startedAt;

    // Pass through status + content-type, drop the rest (we don't want
    // to leak hop-by-hop or encoding headers from the upstream).
    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);

    const text = await upstream.text();

    // eslint-disable-next-line no-console
    console.log(
      `[api/llm] [${requestId}] ← ${upstream.status} ${text.length}chars duration=${durationMs}ms`
    );

    res.send(text);
  } catch (e) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startedAt;
    const isAbort = e instanceof Error && e.name === "AbortError";
    // eslint-disable-next-line no-console
    console.error(
      `[api/llm] [${requestId}] ERROR ${isAbort ? "timeout" : "network"} ` +
        `upstream=${upstreamUrl} after ${durationMs}ms`,
      e instanceof Error ? e.message : e
    );
    res.status(isAbort ? 504 : 502).json({
      error: isAbort
        ? `Upstream LLM did not respond within ${DEFAULT_TIMEOUT_MS / 1000}s`
        : "Failed to reach upstream LLM",
    });
  }
}
