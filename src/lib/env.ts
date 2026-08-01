/**
 * Centralized, typed access to `import.meta.env` for the Tennis Report Hub.
 *
 * Two reasons this file exists:
 *
 * 1. **Type-safe parsers.** Vite gives us every env var as a string (or
 *    undefined). Callers almost always want a boolean / number / enum —
 *    centralising the parse logic means we only have to handle "true" vs
 *    "false" / "1" / "yes" / blank / garbage in one place.
 *
 * 2. **Single grep target.** If a future audit asks "where do we read env
 *    vars from?", the answer is "this file, nowhere else". Every consumer
 *    (`src/api/llm.ts`, `src/store/persistence.ts`) imports `env` and
 *    calls its accessors instead of touching `import.meta.env` directly.
 *
 * Rule of thumb for callers:
 *
 *   const apiKey = env.llm.apiKey() ?? savedConfig.apiKey;
 *
 * Env wins when set; otherwise fall through to the runtime override
 * (localStorage / saved config). Blank env values are treated as
 * "unset" — `parseBool("")` returns `undefined`, not `false`.
 */

import type { LLMProvider, SearchProvider } from "@/types";

// ---- Low-level parsers ----------------------------------------------------

/** Trim and return the string, or undefined if it's empty / whitespace. */
function trimOrUndefined(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Parse a boolean env var. Returns `undefined` for blank / unparseable
 * values so the caller can fall through to a runtime default. Accepts
 * the common forms: "true" / "false" / "1" / "0" / "yes" / "no" (case-
 * insensitive). Anything else is treated as "unset".
 */
function parseBool(raw: string | undefined): boolean | undefined {
  const v = trimOrUndefined(raw)?.toLowerCase();
  if (v == null) return undefined;
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return undefined;
}

/**
 * Parse a finite number env var. Returns `undefined` for blank / NaN
 * / non-finite values.
 */
function parseNumber(raw: string | undefined): number | undefined {
  const v = trimOrUndefined(raw);
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse an enum-like env var. Returns the value if it's in the allowed
 * set, otherwise `undefined`. Use this for provider / search-backend
 * identifiers where an unknown value should NOT silently coerce to a
 * default (better to fall through to the user's saved config).
 */
function parseEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[]
): T | undefined {
  const v = trimOrUndefined(raw);
  if (v == null) return undefined;
  return (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

// ---- Typed env accessors --------------------------------------------------

const LLM_PROVIDERS: readonly LLMProvider[] = [
  "anthropic",
  "openai-compatible",
] as const;

const SEARCH_PROVIDERS: readonly SearchProvider[] = [
  "firecrawl",
  "duckduckgo",
  "serpapi",
  "brave",
] as const;

export const env = {
  // ---- Tennis data ----
  rapidApiKey: (): string | undefined =>
    trimOrUndefined(import.meta.env.VITE_RAPID_API_KEY),

  // ---- LLM ----
  llm: {
    enabled: (): boolean | undefined => parseBool(import.meta.env.VITE_LLM_ENABLED),
    provider: (): LLMProvider | undefined =>
      parseEnum(import.meta.env.VITE_LLM_PROVIDER, LLM_PROVIDERS),
    baseUrl: (): string | undefined =>
      trimOrUndefined(import.meta.env.VITE_LLM_BASE_URL),
    apiKey: (): string | undefined =>
      trimOrUndefined(import.meta.env.VITE_LLM_API_KEY),
    model: (): string | undefined => trimOrUndefined(import.meta.env.VITE_LLM_MODEL),
    temperature: (): number | undefined =>
      parseNumber(import.meta.env.VITE_LLM_TEMPERATURE),
    maxTokens: (): number | undefined =>
      parseNumber(import.meta.env.VITE_LLM_MAX_TOKENS),
    enableThinking: (): boolean | undefined =>
      parseBool(import.meta.env.VITE_LLM_ENABLE_THINKING),
    enableWebSearch: (): boolean | undefined =>
      parseBool(import.meta.env.VITE_LLM_ENABLE_WEB_SEARCH),
  },

  // ---- Web search backend ----
  search: {
    provider: (): SearchProvider | undefined =>
      parseEnum(import.meta.env.VITE_LLM_SEARCH_PROVIDER, SEARCH_PROVIDERS),
    apiKey: (): string | undefined =>
      trimOrUndefined(import.meta.env.VITE_LLM_SEARCH_API_KEY),
  },
} as const;
