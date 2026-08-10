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

// Vite injects `import.meta.env.VITE_*` at build / dev time. We
// use explicit dot-access (not computed) so Vite's static analyzer
// can substitute the values in the client bundle. In Node-only
// contexts (tsx scripts, serverless functions before Vercel wires
// them up, etc.) `import.meta.env` is undefined; fall back to
// process.env so the same source works in both environments.
//
// IMPORTANT: only env vars referenced via this helper at module top
// level are statically substituted. New env vars must be added here.
function readRapidKey(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMeta = (import.meta as any).env.VITE_RAPID_API_KEY;
  if (fromMeta !== undefined) return fromMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITE_RAPID_API_KEY;
}
function readLlmEnabled(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMeta = (import.meta as any).env.VITE_LLM_ENABLED;
  if (fromMeta !== undefined) return fromMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITE_LLM_ENABLED;
}
function readLlmProvider(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMeta = (import.meta as any).env.VITE_LLM_PROVIDER;
  if (fromMeta !== undefined) return fromMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITE_LLM_PROVIDER;
}
function readLlmBaseUrl(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMeta = (import.meta as any).env.VITE_LLM_BASE_URL;
  if (fromMeta !== undefined) return fromMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITE_LLM_BASE_URL;
}
function readLlmApiKey(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMeta = (import.meta as any).env.VITE_LLM_API_KEY;
  if (fromMeta !== undefined) return fromMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITE_LLM_API_KEY;
}
function readLlmModel(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMeta = (import.meta as any).env.VITE_LLM_MODEL;
  if (fromMeta !== undefined) return fromMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITE_LLM_MODEL;
}
function readLlmTemperature(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMeta = (import.meta as any).env.VITE_LLM_TEMPERATURE;
  if (fromMeta !== undefined) return fromMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITE_LLM_TEMPERATURE;
}
function readLlmMaxTokens(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMeta = (import.meta as any).env.VITE_LLM_MAX_TOKENS;
  if (fromMeta !== undefined) return fromMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITE_LLM_MAX_TOKENS;
}
function readLlmThinking(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMeta = (import.meta as any).env.VITE_LLM_ENABLE_THINKING;
  if (fromMeta !== undefined) return fromMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITE_LLM_ENABLE_THINKING;
}
function readLlmWebSearch(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMeta = (import.meta as any).env.VITE_LLM_ENABLE_WEB_SEARCH;
  if (fromMeta !== undefined) return fromMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITE_LLM_ENABLE_WEB_SEARCH;
}
function readSearchProvider(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMeta = (import.meta as any).env.VITE_LLM_SEARCH_PROVIDER;
  if (fromMeta !== undefined) return fromMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITE_LLM_SEARCH_PROVIDER;
}
function readSearchApiKey(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMeta = (import.meta as any).env.VITE_LLM_SEARCH_API_KEY;
  if (fromMeta !== undefined) return fromMeta;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITE_LLM_SEARCH_API_KEY;
}

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
    trimOrUndefined(readRapidKey()),

  // ---- LLM ----
  llm: {
    enabled: (): boolean | undefined => parseBool(readLlmEnabled()),
    provider: (): LLMProvider | undefined =>
      parseEnum(readLlmProvider(), LLM_PROVIDERS),
    baseUrl: (): string | undefined =>
      trimOrUndefined(readLlmBaseUrl()),
    apiKey: (): string | undefined =>
      trimOrUndefined(readLlmApiKey()),
    model: (): string | undefined => trimOrUndefined(readLlmModel()),
    temperature: (): number | undefined =>
      parseNumber(readLlmTemperature()),
    maxTokens: (): number | undefined =>
      parseNumber(readLlmMaxTokens()),
    enableThinking: (): boolean | undefined =>
      parseBool(readLlmThinking()),
    enableWebSearch: (): boolean | undefined =>
      parseBool(readLlmWebSearch()),
  },

  // ---- Web search backend ----
  search: {
    provider: (): SearchProvider | undefined =>
      parseEnum(readSearchProvider(), SEARCH_PROVIDERS),
    apiKey: (): string | undefined =>
      trimOrUndefined(readSearchApiKey()),
  },
} as const;
