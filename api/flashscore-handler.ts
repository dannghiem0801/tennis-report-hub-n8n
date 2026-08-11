/**
 * Vercel serverless function — FlashScore4 (RapidAPI) proxy.
 *
 * Mounted at `/api/flashscore-handler` and reached via a Vercel
 * rewrite in `vercel.json`:
 *
 *   { "source": "/api/flashscore/:path*", "destination": "/api/flashscore-handler" }
 *
 * The `:path*` wildcard captures the upstream path (e.g.
 * `v2/matches/list-by-date`) and forwards the original URL to this
 * function. The function reads `req.url` to recover the path.
 *
 * Why this indirection:
 *   Vercel Functions' catch-all `[...slug]` only matches a single
 *   trailing segment when nested. Multi-segment paths like
 *   `/api/flashscore/v2/matches/list-by-date` don't match
 *   `api/flashscore/[...slug].ts`. The rewrite pattern is a
 *   workaround that routes ALL `/api/flashscore/*` paths to one
 *   function file.
 *
 * Env vars (server-side only):
 *   - `RAPID_API_KEY`   — preferred X-Rapidapi-Key value.
 *   - `RAPID_MCP_API_KEY` — fallback when one RapidAPI application key is
 *     configured for both the REST proxy and MCP enrichment.
 *   - `RAPID_API_HOST`  — optional. Default `flashscore4.p.rapidapi.com`.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

const DEFAULT_HOST = "flashscore4.p.rapidapi.com";
const DEFAULT_TIMEOUT_MS = 30_000;

/** Prefer the dedicated REST key, but ignore empty dashboard placeholders. */
export function getRapidApiKey(
  env: Record<string, string | undefined>
): string | undefined {
  return env.RAPID_API_KEY?.trim() || env.RAPID_MCP_API_KEY?.trim() || undefined;
}

function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Rapidapi-Key, X-Rapidapi-Host"
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

  const apiKey = getRapidApiKey(process.env);
  if (!apiKey) {
    // Do not log a key value. This makes a Preview-scope problem visible in
    // Vercel logs instead of surfacing only as a generic browser-side 500.
    console.error("[api/flashscore] missing RAPID_API_KEY and RAPID_MCP_API_KEY");
    res.status(500).json({ error: "Server misconfigured: RAPID_API_KEY or RAPID_MCP_API_KEY not set" });
    return;
  }

  const host = process.env.RAPID_API_HOST ?? DEFAULT_HOST;

  // Recover the upstream path from the original URL. The rewrite in
  // vercel.json forwards `/api/flashscore/<x>` to this handler
  // without modifying `req.url`; the full pathname (starting with
  // `/api/flashscore/`) is what RapidAPI expects — we forward the
  // entire thing, just swapping origin to the upstream host.
  const incoming = new URL(req.url ?? "/", "http://placeholder.local");
  const upstreamPath = incoming.pathname; // e.g. /api/flashscore/v2/matches/list-by-date
  const queryString = incoming.search.slice(1); // drop leading "?"

  const upstreamUrl = `https://${host}${upstreamPath}${
    queryString ? `?${queryString}` : ""
  }`;

  const upstreamHeaders: Record<string, string> = {
    "X-Rapidapi-Key": apiKey,
    "X-Rapidapi-Host": host,
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    upstreamHeaders["Content-Type"] =
      (req.headers["content-type"] as string) ?? "application/json";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method ?? "GET",
      headers: upstreamHeaders,
      body:
        req.method !== "GET" && req.method !== "HEAD"
          ? typeof req.body === "string"
            ? req.body
            : JSON.stringify(req.body)
          : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const durationMs = Date.now() - startedAt;

    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);

    // eslint-disable-next-line no-console
    console.log(
      `[api/flashscore] ${upstream.status} ${req.method} ${upstreamUrl} duration=${durationMs}ms`
    );

    const text = await upstream.text();
    res.send(text);
  } catch (e) {
    clearTimeout(timeoutId);
    const isAbort = e instanceof Error && e.name === "AbortError";
    // eslint-disable-next-line no-console
    console.error(
      `[api/flashscore] ERROR ${isAbort ? "timeout" : "network"} upstream=${upstreamUrl} after ${Date.now() - startedAt}ms`,
      e
    );
    res.status(isAbort ? 504 : 502).json({
      error: isAbort
        ? "Upstream API did not respond within timeout"
        : "Failed to reach upstream API",
    });
  }
}
