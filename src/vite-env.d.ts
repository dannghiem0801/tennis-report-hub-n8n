/// <reference types="vite/client" />

/**
 * Typed shape of `import.meta.env` for the Tennis Report Hub.
 *
 * Vite exposes ONLY variables prefixed with `VITE_` to client code. Every
 * key we read at runtime is declared here so TypeScript catches typos
 * (`import.meta.env.VITE_RAPID_API_KY` would compile to `undefined` at
 * runtime, but the type system flags it as a missing property).
 *
 * All values are `string | undefined`. The `src/lib/env.ts` helpers convert
 * them to booleans / numbers / typed enums and apply defaults.
 *
 * When you add a new `VITE_` variable:
 *   1. Add it to `.env.example` (the template, committed).
 *   2. Add it to `.env.local` (the local file, gitignored).
 *   3. Declare it here so it's typed.
 *   4. Add a parser in `src/lib/env.ts`.
 */
interface ImportMetaEnv {
  // ---- Tennis data ----
  /** RapidAPI key for livescore6 tennis endpoint. */
  readonly VITE_RAPID_API_KEY?: string;

  // ---- LLM (Anthropic / OpenAI-compatible) ----
  /** "true" / "false" string. Master switch for the LLM. */
  readonly VITE_LLM_ENABLED?: string;
  /** "anthropic" | "openai-compatible" */
  readonly VITE_LLM_PROVIDER?: string;
  /** Base URL (no trailing path). */
  readonly VITE_LLM_BASE_URL?: string;
  /** Bearer token (OpenAI) or x-api-key (Anthropic). */
  readonly VITE_LLM_API_KEY?: string;
  /** Model identifier. */
  readonly VITE_LLM_MODEL?: string;
  /** Sampling temperature, numeric string. */
  readonly VITE_LLM_TEMPERATURE?: string;
  /** Max output tokens, numeric string. */
  readonly VITE_LLM_MAX_TOKENS?: string;
  /** "true" / "false" string. Anthropic only. */
  readonly VITE_LLM_ENABLE_THINKING?: string;
  /** "true" / "false" string. Anthropic only. */
  readonly VITE_LLM_ENABLE_WEB_SEARCH?: string;

  // ---- Web search backend (used by the LLM's `web_search` tool) ----
  /** "firecrawl" | "duckduckgo" | "serpapi" | "brave" */
  readonly VITE_LLM_SEARCH_PROVIDER?: string;
  /** API key for the chosen search backend. */
  readonly VITE_LLM_SEARCH_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
