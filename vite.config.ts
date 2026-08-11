import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { envWriterPlugin } from './vite-plugins/env-writer.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env vars from .env files. `LLM_PROXY_URL` is the target
  // the Vite dev proxy forwards browser requests to (e.g. your
  // Anthropic-compatible proxy). Per the Minimax Anthropic-compatible
  // spec, the upstream base is `https://api.minimax.io/anthropic`
  // (NOT just `https://api.minimax.io`). The endpoint is
  // `${base}/v1/messages`. Set in `.env.local`:
  //   LLM_PROXY_URL=https://api.minimax.io/anthropic
  // Browser calls go to `/llm-proxy/v1/messages`, Vite strips the
  // `/llm-proxy` prefix and forwards to the real upstream — no CORS.
  const env = loadEnv(mode, __dirname, "");
  const llmProxyUrl = env.LLM_PROXY_URL || "https://api.minimax.io/anthropic";
  const rapidApiHost = env.RAPID_API_HOST || "flashscore4.p.rapidapi.com";

  return {
    // `envWriterPlugin` exposes `POST /__save-env` so the Settings
    // UI can persist a key value back to `.env.local` (and trigger a
    // Vite full-reload via the file watcher). Dev-only — see plugin
    // source for the security model.
    plugins: [envWriterPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // The dev proxy. Browser → http://localhost:5173/llm-proxy/* →
      // Vite strips /llm-proxy and forwards to the configured upstream.
      // No CORS issue because the browser sees only localhost.
      proxy: {
        "/llm-proxy": {
          target: llmProxyUrl,
          changeOrigin: true,
          secure: true,
          // Rewrite /llm-proxy/v1/messages → ${target}/v1/messages
          rewrite: (path) => path.replace(/^\/llm-proxy/, "") || "/",
        },
        // Local equivalent of the production Vercel function. The RapidAPI
        // key stays in the Vite process and is never exposed to the browser.
        "/api/flashscore": {
          target: `https://${rapidApiHost}`,
          changeOrigin: true,
          secure: true,
          headers: {
            ...(env.RAPID_API_KEY ? { "X-Rapidapi-Key": env.RAPID_API_KEY } : {}),
            "X-Rapidapi-Host": rapidApiHost,
          },
        },
        // Search proxy for the `web_search` custom tool. Browser →
        // http://localhost:5173/search-proxy/?q=... → Vite forwards
        // to DuckDuckGo HTML. No CORS, no API key needed.
        // Used by `executeWebSearch` in src/api/llm.ts.
        // In production builds, this proxy doesn't exist, so the
        // search call returns a clear "not configured" error.
        "/search-proxy": {
          target: "https://html.duckduckgo.com",
          changeOrigin: true,
          secure: true,
          // Rewrite /search-proxy/?q=foo → /html/?q=foo
        rewrite: (path) => path.replace(/^\/search-proxy/, "/html") || "/html/",
        },
        // Firecrawl proxy. Browser → /firecrawl-proxy/v2/search
        // → https://api.firecrawl.dev/v2/search. Avoids the cross-
        // origin request that Chrome / ad-blockers report as a
        // bogus "403 Failed to load resource" in the console. The
        // API key is still sent by the browser, but only to
        // localhost — no CORS preflight, no browser-side rejection.
        "/firecrawl-proxy": {
          target: "https://api.firecrawl.dev",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/firecrawl-proxy/, "") || "/",
        },
      },
    },
  };
});
