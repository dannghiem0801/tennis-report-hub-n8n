/**
 * LLM client — supports two providers:
 *
 * 1. Anthropic Messages API (`/v1/messages`)
 *    - Auth: `x-api-key: <key>` + `anthropic-version: 2023-06-01`
 *    - Verified against the Minimax Anthropic-compatible spec
 *      (platform.minimax.io/docs/api-reference/text-anthropic-api):
 *        - Base URL: `${baseUrl}/v1/messages` where baseUrl is the
 *          proxy root, e.g. `https://api.minimax.io/anthropic`.
 *        - Supported models include `MiniMax-M3` (1M context,
 *          reasoning model with `thinking` blocks), `MiniMax-M2.7`,
 *          `MiniMax-M2.5`, `MiniMax-M2.1`, `MiniMax-M2` (+ highspeed
 *          variants).
 *        - `temperature` range [0, 2]; `max_tokens` required.
 *        - The Minimax proxy does NOT implement Anthropic's
 *          server-side tools (`web_search_20250305` etc.). We never
 *          declare `tools` in the request — the model writes reports
 *          using only the data we send.
 *        - `thinking: {"type": "adaptive"}` is enabled by default for
 *          reasoning models. Without thinking, MiniMax-M3 leaks fake
 *          `<tool_call>` blocks into the text output. With thinking,
 *          it reasons internally and produces a clean report.
 *        - Multi-turn flow: model returns `tool_use` blocks, we send
 *          back empty `tool_result` blocks (server fills in results),
 *          model returns final `text`. Loop until `stop_reason` is
 *          `end_turn` / `max_tokens` / `stop_sequence`. Per the spec,
 *          the full assistant content (including any `thinking`
 *          blocks) must be preserved unchanged in later turns.
 *
 * 2. OpenAI-compatible Chat Completions (`/chat/completions`)
 *    - Auth: `Authorization: Bearer <key>`
 *    - Works with OpenAI, Azure, Groq, Together.ai, OpenRouter,
 *      Ollama, LM Studio, llama.cpp server, custom proxies.
 *    - Single-turn. No tool support in this code path — the
 *      request body does NOT include a `tools` field.
 *
 * Dev mode: in `import.meta.env.DEV`, non-localhost baseUrls are
 * automatically rewritten to `/llm-proxy/...` so the Vite dev
 * server proxies them through (no CORS). In production, calls go
 * directly to the configured baseUrl.
 *
 * Browser-direct: keys are stored in localStorage and sent from the
 * client. Acceptable for personal/demo use; for production, route
 * through a server-side proxy.
 *
 * `callLLM` is the public entry point — it picks the right client
 * based on `config.provider` and returns a unified `CallLLMResult`
 * with the FULL chat completion content, the model's `finishReason`,
 * and token usage. No sanitization: reasoning blocks, tool-call
 * XML, and preamble are all preserved verbatim.
 */

import type { LLMConfig } from "@/types";
import { env } from "@/lib/env";

const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes

// ---- Provider-specific defaults ----
// Anthropic Messages API. The app uses the request/response shape of
// the official Anthropic API, but the user typically points `baseUrl`
// at their own Anthropic-compatible proxy (e.g. an internal gateway
// that exposes `/v1/messages` and forwards to whatever model they want).
// `baseUrl` and `model` default to empty so the user MUST configure
// them — the app never assumes a specific LLM provider.
const ANTHROPIC_API_VERSION = "2023-06-01";
const ANTHROPIC_DEFAULT_MAX_TOKENS = 200000;
const OPENAI_COMPATIBLE_DEFAULT_MAX_TOKENS = 200000;
const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = "https://api.openai.com/v1";

// ---- Public LLM config defaults + migration ----

/**
 * Default LLM config used when no localStorage entry exists or the
 * entry is missing required fields. The provider is "anthropic" by
 * default (Anthropic Messages API format), but `baseUrl`, `apiKey`,
 * and `model` are EMPTY so the user must configure their own
 * Anthropic-compatible proxy + model. The app never assumes a
 * specific LLM provider.
 *
 * Both `enableThinking` and `enableWebSearch` default to true:
 * - `enableThinking`: MiniMax-M3 is a reasoning model per the spec —
 *   enabling `thinking: {type: "adaptive"}` lets it reason internally
 *   and produce a clean text report instead of leaking fake
 *   `<tool_call>` blocks into the output.
 * - `enableWebSearch`: declares a custom `web_search` tool so the
 *   model can verify scores / look up context. Client-side execution
 *   currently returns a clear "not configured" stub; the model
 *   handles this gracefully per the prompt.
 *
 * **Env-layer (see `src/lib/env.ts`)**: every field below also reads
 * from `import.meta.env` via the `env` helper. When the corresponding
 * `VITE_LLM_*` variable is set in `.env.local`, it overrides the
 * hardcoded default here. This is the canonical way to ship
 * pre-configured keys to a fresh install without touching the UI.
 */
export const DEFAULT_LLM: LLMConfig = {
  enabled: env.llm.enabled() ?? false,
  provider: env.llm.provider() ?? "anthropic",
  apiKey: env.llm.apiKey() ?? "",
  baseUrl: env.llm.baseUrl() ?? "",
  model: env.llm.model() ?? "",
  maxTokens: env.llm.maxTokens() ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
  enableThinking: env.llm.enableThinking() ?? true,
  enableWebSearch: env.llm.enableWebSearch() ?? true,
  searchProvider: env.search.provider() ?? "firecrawl",
  searchApiKey: env.search.apiKey() ?? "",
};

/**
 * Reconcile a saved LLM config (possibly from an older schema) into
 * the current shape. Backfills missing fields, defaults `provider`
 * to "anthropic" for legacy entries that don't have one.
 *
 * **Precedence (highest to lowest):**
 *   1. Env vars (`VITE_LLM_*` in `.env.local`) — canonical, set once.
 *   2. Saved config (localStorage) — runtime override from Settings UI.
 *   3. Hardcoded defaults (`DEFAULT_LLM`).
 *
 * Env always wins on startup. If you want a Settings UI change to
 * stick across reloads, leave the corresponding `VITE_LLM_*` blank.
 */
export function migrateLLMConfig(saved: Partial<LLMConfig> | undefined): LLMConfig {
  if (!saved) return { ...DEFAULT_LLM };
  return {
    ...DEFAULT_LLM,
    ...saved,
    // Backfill provider for legacy entries
    provider: saved.provider ?? DEFAULT_LLM.provider,
    // Re-apply env on top of saved so env vars win. Only overlay a
    // field when env actually has a value (parseBool / parseNumber
    // return undefined for blank, so blank env vars don't clobber a
    // saved value the user typed in Settings).
    ...(env.llm.enabled() !== undefined && { enabled: env.llm.enabled()! }),
    ...(env.llm.provider() && { provider: env.llm.provider()! }),
    ...(env.llm.baseUrl() && { baseUrl: env.llm.baseUrl()! }),
    ...(env.llm.apiKey() && { apiKey: env.llm.apiKey()! }),
    ...(env.llm.model() && { model: env.llm.model()! }),
    ...(env.llm.temperature() !== undefined && { temperature: env.llm.temperature()! }),
    ...(env.llm.maxTokens() !== undefined && { maxTokens: env.llm.maxTokens()! }),
    ...(env.llm.enableThinking() !== undefined && { enableThinking: env.llm.enableThinking()! }),
    ...(env.llm.enableWebSearch() !== undefined && { enableWebSearch: env.llm.enableWebSearch()! }),
    ...(env.search.provider() && { searchProvider: env.search.provider()! }),
    ...(env.search.apiKey() && { searchApiKey: env.search.apiKey()! }),
  };
}

// ---- Error type ----

export class LLMError extends Error {
  status: number;
  code: "network" | "unauthorized" | "forbidden" | "rate_limited" | "bad_request" | "server" | "cors" | "no_data" | "timeout";
  constructor(message: string, status: number, code: LLMError["code"]) {
    super(message);
    this.name = "LLMError";
    this.status = status;
    this.code = code;
  }
}

export interface CallLLMOptions {
  /** Full prompt (system + user concatenated by the caller). */
  prompt: string;
  /** LLM config from settings. */
  config: LLMConfig;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Timeout in ms. Default 180s. */
  timeoutMs?: number;
}

export interface CallLLMResult {
  /** The FULL chat completion content (no sanitization). For non-streaming
   *  requests, this is the complete response. */
  content: string;
  /** The model's reported finish_reason. For Anthropic: "end_turn" |
   *  "max_tokens" | "stop_sequence" | "tool_use" | "unknown". For
   *  OpenAI-compatible: "stop" | "length" | "tool_calls" | "unknown". */
  finishReason: string;
  /** If the model returned tool_calls in the message (not as content),
   *  the raw array is exposed here for debugging. */
  toolCalls?: unknown;
  /** Provider-reported usage if present. */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  /** Echoed for logs / debugging. */
  model: string;
}

// ---- Dispatcher ----

/**
 * Call the configured LLM and return the full chat completion.
 * Branches on `config.provider` — Anthropic gets the multi-turn
 * server-tool flow, OpenAI-compatible gets a single request.
 * Throws LLMError on any failure. The caller (generateReport) decides
 * what to do on error — typically fall back to prompt-only mode.
 */
export async function callLLM(opts: CallLLMOptions): Promise<CallLLMResult> {
  const provider = opts.config.provider ?? "anthropic";
  if (provider === "anthropic") return callAnthropic(opts);
  return callOpenAICompatible(opts);
}

// =====================================================================
// Anthropic Messages API
// =====================================================================

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
interface AnthropicTextBlock {
  type: "text";
  text: string;
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | { type: string; [k: string]: unknown };

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  error?: { type: string; message: string };
}

async function callAnthropic(opts: CallLLMOptions): Promise<CallLLMResult> {
  // Expose config to the tool executor (which runs inside Promise.all
  // during the multi-turn loop). Cleared in `finally` below.
  currentLLMConfig = opts.config;
  try {
    return await callAnthropicInner(opts);
  } finally {
    currentLLMConfig = null;
  }
}

async function callAnthropicInner(opts: CallLLMOptions): Promise<CallLLMResult> {
  const { prompt, config, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  // ---- Validation ----
  if (!config.apiKey) {
    throw new LLMError("Anthropic API key chưa được cấu hình. Vào Settings để nhập key.", 0, "unauthorized");
  }
  if (!config.model) {
    throw new LLMError("Model chưa được cấu hình. Vào Settings để chọn model Anthropic.", 0, "bad_request");
  }

  const rawBaseUrl = (config.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!rawBaseUrl) {
    throw new LLMError(
      "Base URL chưa được cấu hình cho Anthropic-compatible provider. Vào Settings → LLM → Base URL để nhập (vd. https://api.minimax.io/anthropic).",
      0,
      "bad_request"
    );
  }
  // In dev, rewrite non-localhost baseUrls to /llm-proxy so the Vite
  // dev server proxies them (no CORS). In production, call directly.
  const baseUrl = resolveDevProxyUrl(rawBaseUrl);
  const url = `${baseUrl}/v1/messages`;

  // Loud diagnostic so we can confirm the dev proxy is firing
  // eslint-disable-next-line no-console
  console.log(
    `[llm] callAnthropic → ${url} (rawBaseUrl=${rawBaseUrl}, baseUrl=${baseUrl}, ` +
      `isDev=${typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true})`
  );

  // ---- Split prompt into system + user at the "## Dữ liệu trận đấu" marker ----
  // The tennis template concatenates persona/rules + match data into a
  // single string. Anthropic prefers the persona in `system` and the
  // user request in `messages`, so we split at the data-section header
  // if present. Falls back to whole-prompt-as-user if the marker is
  // missing (e.g. user customized the template).
  const splitMarker = "## Dữ liệu trận đấu";
  const splitIdx = prompt.indexOf(splitMarker);
  const systemPrompt = splitIdx > 0 ? prompt.slice(0, splitIdx).trim() : "";
  const userMessage = splitIdx > 0 ? prompt.slice(splitIdx).trim() : prompt;

  // ---- Thinking blocks ----
  // Per the Minimax Anthropic spec, MiniMax-M3 supports
  // `thinking: {"type": "adaptive"}` to enable reasoning. Without
  // this, the model has no place to put its internal reasoning and
  // tends to leak fake `<tool_call>` blocks into the text output.
  // Default ON. The user can disable it in Settings for M2.x models
  // where thinking is non-configurable.
  const thinkingEnabled = config.enableThinking !== false;
  const thinking = thinkingEnabled ? { type: "adaptive" as const } : undefined;

  // ---- Custom tools ----
  // `web_search` is a CLIENT-EXECUTED custom tool. The model emits a
  // `tool_use` block with `{"query": "..."}`; we run the search and
  // return the result in a `tool_result` block. The Anthropic proxy
  // doesn't execute anything for us (unlike Anthropic's own
  // `web_search_20250305` server tool which the Minimax proxy does
  // not implement).
  //
  // Current implementation: stub. The user can wire up a real
  // search backend by replacing `executeWebSearch` below.
  const webSearchEnabled = config.enableWebSearch !== false;
  const tools = webSearchEnabled
    ? [
        {
          name: "web_search",
          description:
            "Search the web for current tennis information: player stats, recent form, head-to-head records, tournament draws, match results, injury updates, post-match quotes. Returns a list of relevant snippets with source names (Flashscore, Sofascore, ATP/WTA Tour, ESPN, BBC, Reuters, etc.), or a clear 'not configured' message if no search backend is wired up — in which case fall back to writing from the provided match data.",
          input_schema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "Search query in English or Vietnamese. Be specific: include player names, tournament, date, and what you want to verify. Example: 'Sabalenka vs Swiatek Wimbledon 2026 final score'.",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "scrape_url",
          description:
            "Scrape a specific URL and return the rendered page content as markdown. Use this when you have a direct URL to a page with relevant data — e.g., a Flashscore match page (for point-by-point data + detailed stats), a Tennis Abstract chart page, or a specific news article. Firecrawl renders JavaScript-heavy pages, so this works for sites that load data dynamically. The Firecrawl API key must be configured in Settings (the same key used for web_search when searchProvider=firecrawl). Returns the rendered markdown content; falls back to a clear error if no key is configured or the page can't be reached.",
          input_schema: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description:
                  "Full URL to scrape. Must include https://. Example: 'https://www.flashscore.com/match/tennis/...' or 'https://www.tennisabstract.com/charting/...'",
              },
            },
            required: ["url"],
          },
        },
      ]
    : undefined;

  // ---- Multi-turn loop ----
  // The model may call `web_search` (one or more times), then return
  // text. Each turn:
  //   1. Send messages (initially just the user message)
  //   2. Parse response
  //   3. If stop_reason is "tool_use", append the assistant's full
  //      content (per spec, must be preserved unchanged) and a
  //      user-side `tool_result` block with the CLIENT-EXECUTED
  //      search result.
  //   4. If stop_reason is "end_turn" / "max_tokens" / "stop_sequence",
  //      extract final text and break.
  //   5. Bail out at maxTurns to avoid infinite loops.
  const messages: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }> = [
    { role: "user", content: userMessage },
  ];

  let totalInput = 0;
  let totalOutput = 0;
  let allText = "";
  let stopReason = "unknown";
  let model = config.model;
  let lastError: string | null = null;
  const maxTurns = 10;

  for (let turn = 0; turn < maxTurns; turn++) {
    const requestId = `ant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const startedAt = Date.now();
    // eslint-disable-next-line no-console
    console.log(
      `[llm] [${requestId}] → POST ${url} turn=${turn + 1} ` +
        `model=${config.model} ` +
        `max_tokens=${config.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS} ` +
        `thinking=${thinkingEnabled} ` +
        `tools=${tools ? tools.map((t) => t.name).join(",") : "none"} ` +
        `timeout=${(timeoutMs / 1000).toFixed(0)}s`
    );

    const body = {
      model: config.model,
      max_tokens: config.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages,
      ...(thinking ? { thinking } : {}),
      ...(tools ? { tools } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    };

    const timeoutController = new AbortController();
    const timeoutId = window.setTimeout(() => timeoutController.abort(), timeoutMs);
    const composedSignal = signal
      ? anySignal([signal, timeoutController.signal])
      : timeoutController.signal;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify(body),
        signal: composedSignal,
      });
    } catch (e) {
      window.clearTimeout(timeoutId);
      if (e instanceof DOMException && e.name === "AbortError") {
        if (signal?.aborted) throw new LLMError("Đã huỷ yêu cầu LLM.", 0, "network");
        throw new LLMError("Anthropic không phản hồi trong vòng 3 phút (timeout).", 0, "timeout");
      }
      throw new LLMError(
        "Không thể kết nối tới Anthropic. Kiểm tra base URL, network, hoặc CORS.",
        0,
        "cors"
      );
    }
    window.clearTimeout(timeoutId);

    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.error?.message ?? "";
        lastError = body?.error?.message ?? `HTTP ${res.status}`;
      } catch {
        lastError = `HTTP ${res.status}`;
      }
      // eslint-disable-next-line no-console
      console.warn(`[llm] [${requestId}] HTTP ${res.status} ${detail}`);
      throw new LLMError(
        detail || `Anthropic yêu cầu thất bại (${res.status}).`,
        res.status,
        res.status === 401
          ? "unauthorized"
          : res.status === 403
            ? "forbidden"
            : res.status === 429
              ? "rate_limited"
              : res.status === 404
                ? "bad_request"
                : res.status >= 500
                  ? "server"
                  : "bad_request"
      );
    }

    const data: AnthropicResponse = await res.json();
    if (data.error) {
      throw new LLMError(data.error.message || "Anthropic trả về lỗi.", 400, "bad_request");
    }

    model = data.model ?? model;
    totalInput += data.usage?.input_tokens ?? 0;
    totalOutput += data.usage?.output_tokens ?? 0;
    stopReason = data.stop_reason;

    // Extract text and tool_use blocks
    const toolUseBlocks: AnthropicToolUseBlock[] = [];
    for (const block of data.content) {
      if (block.type === "text") {
        allText += (block as AnthropicTextBlock).text ?? "";
      } else if (block.type === "tool_use") {
        toolUseBlocks.push(block as AnthropicToolUseBlock);
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[llm] [${requestId}] ← turn ${turn + 1} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s, ` +
        `stop_reason=${stopReason}, text_so_far=${allText.length}chars, ` +
        `tool_uses=${toolUseBlocks.length}, ` +
        `usage=${data.usage ? `${data.usage.input_tokens + data.usage.output_tokens} tokens (${data.usage.input_tokens}in/${data.usage.output_tokens}out)` : "n/a"}`
    );

    // If no tool_use, the model is done (or truncated)
    if (data.stop_reason === "end_turn" || data.stop_reason === "stop_sequence" || data.stop_reason === "max_tokens") {
      break;
    }

    // Model wants to call a tool — execute each call client-side and
    // send back `tool_result` blocks with the actual result content.
    if (data.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
      // Append the assistant's full content (text + tool_use blocks,
      // including any thinking blocks) so the conversation has the
      // right context per the spec.
      messages.push({ role: "assistant", content: data.content });
      // Execute each tool call in parallel and return results.
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (b) => {
          try {
            const result = await executeToolCall(b);
            // eslint-disable-next-line no-console
            console.log(
              `[llm] [${requestId}] tool ${b.name} ok (${result.length} chars returned)`
            );
            return {
              type: "tool_result" as const,
              tool_use_id: b.id,
              content: result,
            };
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            // eslint-disable-next-line no-console
            console.warn(`[llm] [${requestId}] tool ${b.name} failed: ${errMsg}`);
            return {
              type: "tool_result" as const,
              tool_use_id: b.id,
              content: `[Tool execution failed: ${errMsg}]`,
              is_error: true,
            };
          }
        })
      );
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // Unknown stop_reason — break to avoid infinite loop
    lastError = `unexpected stop_reason: ${data.stop_reason}`;
    break;
  }

  if (allText.length === 0) {
    throw new LLMError(
      `Anthropic trả về response rỗng. ${lastError ?? ""}`.trim(),
      200,
      "no_data"
    );
  }

  if (stopReason === "max_tokens") {
    // eslint-disable-next-line no-console
    console.warn(
      `[llm] Anthropic response TRUNCATED at max_tokens (${config.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS}). ` +
        `Increase "Max tokens" in Settings.`
    );
  }
  if (allText.length < 200) {
    // eslint-disable-next-line no-console
    console.warn(
      `[llm] Anthropic response is suspiciously short (${allText.length} chars). ` +
        `First 200: ${JSON.stringify(allText.slice(0, 200))}`
    );
  }

  return {
    content: allText,
    model,
    finishReason: stopReason,
    usage: {
      promptTokens: totalInput || undefined,
      completionTokens: totalOutput || undefined,
      totalTokens: (totalInput + totalOutput) || undefined,
    },
  };
}

// =====================================================================
// OpenAI-compatible Chat Completions (legacy / fallback)
// =====================================================================

async function callOpenAICompatible(opts: CallLLMOptions): Promise<CallLLMResult> {
  const { prompt, config, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  if (!config.apiKey) {
    throw new LLMError("LLM API key chưa được cấu hình. Vào Settings để nhập key.", 0, "unauthorized");
  }
  if (!config.model) {
    throw new LLMError("Model chưa được cấu hình. Vào Settings để chọn model.", 0, "bad_request");
  }

  const rawBaseUrl = (config.baseUrl ?? OPENAI_COMPATIBLE_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  // In dev, rewrite non-localhost baseUrls to /llm-proxy so the Vite
  // dev server proxies them (no CORS). In production, call directly.
  const baseUrl = resolveDevProxyUrl(rawBaseUrl);
  const url = `${baseUrl}/chat/completions`;

  const requestId = `oai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const startedAt = Date.now();

  const requestBody = JSON.stringify({
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    temperature: config.temperature ?? 0.7,
    max_tokens: config.maxTokens ?? OPENAI_COMPATIBLE_DEFAULT_MAX_TOKENS,
    stream: false,
  });

  // eslint-disable-next-line no-console
  console.log(
    `[llm] [${requestId}] → POST ${url} ` +
      `body=${requestBody.length}chars ` +
      `(model=${config.model} prompt=${prompt.length}chars ` +
      `max_tokens=${config.maxTokens ?? OPENAI_COMPATIBLE_DEFAULT_MAX_TOKENS} ` +
      `timeout=${(timeoutMs / 1000).toFixed(0)}s)`
  );

  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), timeoutMs);
  const composedSignal = signal
    ? anySignal([signal, timeoutController.signal])
    : timeoutController.signal;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: requestBody,
      signal: composedSignal,
    });
  } catch (e) {
    window.clearTimeout(timeoutId);
    if (e instanceof DOMException && e.name === "AbortError") {
      if (signal?.aborted) throw new LLMError("Đã huỷ yêu cầu LLM.", 0, "network");
      throw new LLMError("LLM không phản hồi trong vòng 3 phút (timeout).", 0, "timeout");
    }
    throw new LLMError("Không thể kết nối tới LLM. Kiểm tra base URL, network, hoặc CORS.", 0, "cors");
  }
  window.clearTimeout(timeoutId);

  if (res.status === 401) throw new LLMError("LLM API key không hợp lệ (401).", 401, "unauthorized");
  if (res.status === 403) throw new LLMError("LLM từ chối truy cập (403).", 403, "forbidden");
  if (res.status === 404) throw new LLMError("LLM endpoint trả về 404. Kiểm tra base URL và tên model.", 404, "bad_request");
  if (res.status === 429) throw new LLMError("LLM vượt giới hạn request (429). Chờ 1 phút rồi thử lại.", 429, "rate_limited");
  if (res.status >= 500) throw new LLMError(`LLM lỗi máy chủ (${res.status}). Thử lại sau.`, res.status, "server");
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error?.message || body?.message || "";
    } catch {
      /* ignore */
    }
    throw new LLMError(detail || `LLM yêu cầu thất bại (${res.status}).`, res.status, res.status === 400 ? "bad_request" : "server");
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  const message = choice?.message ?? {};
  const rawContent: string = typeof message.content === "string" ? message.content : "";
  const finishReason: string = choice?.finish_reason ?? "unknown";
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : undefined;

  if (rawContent.length === 0 && toolCalls && toolCalls.length > 0) {
    const prettyCalls = JSON.stringify(toolCalls, null, 2);
    const placeholder =
      `[LLM trả về ${toolCalls.length} tool call(s) thay vì text. Model đang cố gọi tool mà không có tool nào được khai báo trong request.\n\n` +
      `Tool calls:\n\`\`\`json\n${prettyCalls}\n\`\`\`\n\n` +
      `Để LLM viết được bản tin, có 2 cách:\n` +
      `1. Dùng model hỗ trợ tool gọi qua API (vd. OpenAI với web browsing, hoặc Anthropic-compatible proxy có khai báo tools).\n` +
      `2. Bỏ phần "web_search" / "mcp_sofascore_*" trong prompt để model không cố gọi tool nữa.`;
    return { content: placeholder, model: data?.model ?? config.model, finishReason, toolCalls };
  }
  if (rawContent.length === 0) {
    throw new LLMError("LLM trả về response rỗng. Kiểm tra model có hỗ trợ chat completions.", 200, "no_data");
  }

  const content = rawContent;

  // eslint-disable-next-line no-console
  console.log(
    `[llm] [${requestId}] ← HTTP 200 in ${((Date.now() - startedAt) / 1000).toFixed(1)}s, ` +
      `raw=${rawContent.length}chars, ` +
      `finish_reason=${finishReason}, ` +
      `has_tool_calls=${!!toolCalls}, ` +
      `usage=${data?.usage ? `${data.usage.total_tokens} tokens (${data.usage.prompt_tokens}in/${data.usage.completion_tokens}out)` : "n/a"}`
  );

  return {
    content,
    model: data?.model ?? config.model,
    finishReason,
    toolCalls,
    usage: data?.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
  };
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Combine multiple AbortSignals into one. Aborting any input aborts the
 * output. The browser-native `AbortSignal.any()` is not yet universal
 * enough (Safari < 17.4), so we implement a minimal version.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/**
 * Decide whether to route the baseUrl through the Vite dev proxy
 * (`/llm-proxy/*` → real upstream) or call it directly.
 *
 * We use TWO signals to detect dev mode — `import.meta.env.DEV` (Vite's
 * standard) AND the current `window.location.hostname` being localhost
 * / 127.0.0.1. The hostname check is a safety net for cases where
 * the user has a cached production build open in a tab pointed at
 * localhost (where `import.meta.env.DEV` is `false` but the proxy is
 * still available at `/llm-proxy`). Either signal being true triggers
 * the proxy rewrite.
 *
 * Localhost upstreams (Ollama, LM Studio, llama.cpp) are passed through
 * unchanged — they're already same-origin or CORS-friendly.
 *
 * Examples:
 *   resolveDevProxyUrl("https://api.minimax.io/anthropic")  on localhost:5173
 *     → "/llm-proxy"
 *   resolveDevProxyUrl("http://localhost:11434/v1")          on localhost:5173
 *     → "http://localhost:11434/v1"   (passthrough — local LLM)
 *   resolveDevProxyUrl("https://api.openai.com/v1")         on prod build
 *     → "https://api.openai.com/v1"  (no proxy in production)
 */
function resolveDevProxyUrl(baseUrl: string): string {
  // Signal 1: Vite's standard dev flag (works in normal Vite dev).
  const viteDev =
    typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

  // Signal 2: current page is being served from localhost / 127.0.0.1
  // (catches the case where the user has a stale prod build open in a
  // tab whose URL is still localhost — the Vite proxy is reachable
  // there even though import.meta.env.DEV is false).
  let onLocalhost = false;
  try {
    const h = (typeof window !== "undefined" ? window.location.hostname : "").toLowerCase();
    onLocalhost = h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    /* ignore — non-browser context */
  }

  const inDev = viteDev || onLocalhost;
  if (!inDev) return baseUrl;

  // Localhost upstreams: passthrough (Ollama, LM Studio, llama.cpp).
  try {
    const u = new URL(baseUrl);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
      return baseUrl;
    }
  } catch {
    // Not a parseable URL — fall through and rewrite to proxy.
  }

  // Route non-localhost upstreams through the Vite dev proxy.
  return "/llm-proxy";
}

// =====================================================================
// Tool execution (client-side)
// =====================================================================
//
// The Anthropic-compatible API supports custom tools (the `tools`
// parameter is fully supported per the Minimax spec). Unlike
// Anthropic's own server-side tools (e.g. `web_search_20250305`,
// which the Minimax proxy does NOT implement), custom tools are
// executed by the client: the model emits a `tool_use` block, we
// run the tool, and we send back a `tool_result` block.
//
// Current implementation: a single `web_search` tool with a stub
// backend. The stub returns a clear "not configured" message; the
// prompt instructs the model to write from the provided match data
// when this happens. To wire up a real search backend, replace
// `executeWebSearch` below with a real implementation (e.g. via
// DuckDuckGo HTML scraping, SerpAPI, Brave Search, or a custom
// search proxy).

/**
 * Dispatch a tool_use block to the matching client-side handler.
 * Returns the string content that will be placed in the
 * `tool_result` block. Throws on error so the caller can return
 * `is_error: true` to the model.
 */
async function executeToolCall(block: AnthropicToolUseBlock): Promise<string> {
  if (block.name === "web_search") {
    const input = (block.input ?? {}) as { query?: unknown };
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) {
      throw new Error("web_search: missing required parameter 'query'");
    }
    return executeWebSearch(query);
  }
  if (block.name === "scrape_url") {
    const input = (block.input ?? {}) as { url?: unknown };
    const url = typeof input.url === "string" ? input.url.trim() : "";
    if (!url) {
      throw new Error("scrape_url: missing required parameter 'url'");
    }
    return executeScrapeUrl(url);
  }
  throw new Error(`Unknown tool: ${block.name}`);
}

/**
 * Execute a web search. Supports four backends:
 * - "firecrawl" (RECOMMENDED, default) — Firecrawl `/v2/search`.
 *   Returns full markdown content from each result (not just snippets).
 *   CORS-enabled, no proxy needed. 2 credits per 10 results.
 *   Free tier = 500 credits ≈ 250 searches/month.
 *   Needs `searchApiKey` starting with `fc-...`.
 *   https://api.firecrawl.dev/v2/search
 * - "duckduckgo" (fallback, dev-only) — Vite proxy → html.duckduckgo.com.
 *   Free, no key, often rate-limited from non-browser IPs (DDG returns
 *   "Unfortunately, bots use DuckDuckGo too" page). Use only for dev.
 * - "serpapi" — SerpAPI.com. CORS-enabled, no proxy needed. Free tier
 *   100 searches/month. Needs `searchApiKey`. Reliable but snippets only.
 * - "brave"   — Brave Search API. CORS-enabled. Free tier 2000/month.
 *   Needs `searchApiKey`. Snippets only.
 *
 * The dispatcher reads `config.searchProvider` and `config.searchApiKey`.
 * If no provider is set, defaults to "firecrawl".
 */
async function executeWebSearch(query: string): Promise<string> {
  // eslint-disable-next-line no-console
  console.log(`[llm] web_search called: "${query}"`);

  // Read the LLMConfig from the closure. `currentLLMConfig` is set by
  // callAnthropic before each call so we have access to the user's
  // search backend settings.
  const provider = currentLLMConfig?.searchProvider ?? "firecrawl";
  const apiKey = currentLLMConfig?.searchApiKey ?? "";

  if (provider === "firecrawl") {
    if (!apiKey) {
      return `[Firecrawl cần API key. Vào Settings → LLM → Search backend → điền Firecrawl key (fc-...). Trong lúc chờ, hãy viết bài từ dữ liệu livescore.]`;
    }
    return runFirecrawlSearch(query, apiKey);
  }
  if (provider === "serpapi") {
    if (!apiKey) {
      return `[SerpAPI cần API key. Vào Settings → LLM → Search backend → điền SerpAPI key. Trong lúc chờ, hãy viết bài từ dữ liệu livescore.]`;
    }
    return runSerpApiSearch(query, apiKey);
  }
  if (provider === "brave") {
    if (!apiKey) {
      return `[Brave Search cần API key. Vào Settings → LLM → Search backend → điền Brave key. Trong lúc chờ, hãy viết bài từ dữ liệu livescore.]`;
    }
    return runBraveSearch(query, apiKey);
  }
  // Default fallback: duckduckgo (dev-only via Vite proxy)
  return runDuckDuckGoSearch(query);
}

/**
 * Execute `scrape_url` — fetch a specific URL and return its rendered
 * markdown content via Firecrawl `/v2/scrape`.
 *
 * This is the right tool when the model knows the exact URL of a
 * page with relevant data (e.g., a specific Flashscore match page,
 * a Tennis Abstract chart, a news article with detailed stats).
 * Firecrawl renders JavaScript-heavy pages server-side, so it works
 * for sites where the data is loaded dynamically — which is most
 * modern sports sites.
 *
 * Reuses the same Firecrawl key as `web_search` (the `searchApiKey`
 * field when `searchProvider === "firecrawl"`).
 */
async function executeScrapeUrl(url: string): Promise<string> {
  // eslint-disable-next-line no-console
  console.log(`[llm] scrape_url called: "${url}"`);

  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) {
      return `[scrape_url: URL phải bắt đầu bằng http:// hoặc https://. URL nhận được: "${url}"]`;
    }
  } catch {
    return `[scrape_url: URL không hợp lệ: "${url}"]`;
  }

  // Use the same Firecrawl key as the search backend
  const apiKey = currentLLMConfig?.searchApiKey ?? "";
  if (!apiKey) {
    return [
      `[scrape_url cần Firecrawl API key. Vào Settings → LLM → Search backend → điền key (fc-...).]`,
      ``,
      `URL cần scrape: ${url}`,
      `Trong lúc chờ, hãy viết bài từ dữ liệu livescore và ghi "chưa verify được đầy đủ".`,
    ].join("\n");
  }

  // Firecrawl /v2/scrape — renders JS, returns clean markdown
  const SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
  const scrapeTimeoutMs = 30_000; // 30s — Firecrawl needs time to render JS-heavy pages

  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), scrapeTimeoutMs);

  let res: Response;
  try {
    res = await fetch(SCRAPE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        // Wait for JS to render — sports sites like Flashscore load
        // data via GraphQL after page load, so we need to wait
        waitFor: 5000,
        timeout: scrapeTimeoutMs,
        // Block ads/trackers to keep output clean
        blockAds: true,
      }),
      signal: timeoutController.signal,
    });
  } catch (e) {
    window.clearTimeout(timeoutId);
    if (e instanceof DOMException && e.name === "AbortError") {
      return `[scrape_url timeout (${(scrapeTimeoutMs / 1000).toFixed(0)}s) cho URL: ${url}. Trang có thể cần nhiều thời gian hơn để render, hoặc Firecrawl đang bị block.]`;
    }
    return `[scrape_url lỗi mạng: ${e instanceof Error ? e.message : String(e)}]`;
  }
  window.clearTimeout(timeoutId);

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error || body?.message || JSON.stringify(body).slice(0, 200);
    } catch {
      /* ignore */
    }
    return `[scrape_url HTTP ${res.status}${detail ? `: ${detail}` : ""} cho URL: ${url}. Kiểm tra API key hoặc thử URL khác.]`;
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return `[scrape_url: Firecrawl trả về response không phải JSON cho URL: ${url}]`;
  }

  const d = data as { success?: boolean; data?: { markdown?: string; metadata?: { title?: string; description?: string } }; error?: string };
  if (d.success === false) {
    return `[scrape_url: Firecrawl báo lỗi cho URL ${url}: ${d.error ?? "(no error message)"}]`;
  }

  const markdown = (d.data?.markdown || "").trim();
  const title = d.data?.metadata?.title || "";
  const description = d.data?.metadata?.description || "";

  if (!markdown) {
    return `[scrape_url: Firecrawl trả về markdown rỗng cho URL: ${url}. Có thể trang cần nhiều thời gian hơn để render, hoặc data bị chặn.]`;
  }

  // Truncate to keep next LLM call's input tokens bounded.
  // Sports pages can be huge (10K+ chars); we cap to 4K to allow
  // enough context for point-by-point tables + stats tables.
  const MAX_SCRAPE_CHARS = 4000;
  const truncated = markdown.length > MAX_SCRAPE_CHARS;
  const snippet = truncated
    ? markdown.slice(0, MAX_SCRAPE_CHARS) + `\n\n[... truncated — markdown was ${markdown.length} chars, showing first ${MAX_SCRAPE_CHARS} ...]`
    : markdown;

  // Format as a tool_result the LLM can read and reason about.
  const lines: string[] = [];
  lines.push(`[Scraped URL: ${url}]`);
  if (title) lines.push(`(Title: ${title})`);
  if (description) lines.push(`(Description: ${description})`);
  lines.push(`(Source: Firecrawl /v2/scrape — ${markdown.length} chars${truncated ? `, truncated to ${MAX_SCRAPE_CHARS}` : ""})`);
  lines.push(`(Dùng để xác minh tỷ số, lấy thống kê chi tiết, hoặc đọc point-by-point data nếu có trong trang.)`);
  lines.push(``);
  lines.push(snippet);
  return lines.join("\n");
}

/**
 * Firecrawl `/v2/search` (RECOMMENDED).
 *
 *   POST https://api.firecrawl.dev/v2/search
 *   Authorization: Bearer <api-key>
 *   {
 *     "query": "<search query>",
 *     "limit": 5,
 *     "scrapeOptions": { "formats": ["markdown"] }
 *   }
 *
 * Returns rich web data: each result has `title`, `url`, `description`
 * (snippet) and `markdown` (full page content if scrapeOptions enabled).
 * Markdown is truncated to MAX_MARKDOWN_CHARS per result to keep the
 * next LLM call's input tokens bounded.
 *
 * Cost: 2 credits per 10 results. Free tier = 500 credits ≈ 250
 * searches/month. Sign up: https://www.firecrawl.dev/
 */
const FIRECRAWL_MAX_MARKDOWN_CHARS = 1500;

async function runFirecrawlSearch(query: string, apiKey: string): Promise<string> {
  const searchTimeoutMs = 15_000; // Firecrawl does search+scrape — slower
  const url = "https://api.firecrawl.dev/v2/search";

  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), searchTimeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query,
        limit: 5,
        // Scrape top results to get full markdown — gives the LLM
        // enough context to actually verify scores (not just snippets).
        scrapeOptions: { formats: ["markdown"] },
      }),
      signal: timeoutController.signal,
    });
  } catch (e) {
    window.clearTimeout(timeoutId);
    if (e instanceof DOMException && e.name === "AbortError") {
      return `[Firecrawl timeout (${(searchTimeoutMs / 1000).toFixed(0)}s) cho query. Vui lòng thử lại.]`;
    }
    return `[Firecrawl lỗi mạng: ${e instanceof Error ? e.message : String(e)}. Hãy viết bài từ dữ liệu livescore.]`;
  }
  window.clearTimeout(timeoutId);

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error || body?.message || (body?.detail ? String(body.detail) : "");
    } catch {
      /* ignore */
    }
    return `[Firecrawl HTTP ${res.status}${detail ? `: ${detail}` : ""}. Kiểm tra API key trong Settings → LLM → Search backend. Trong lúc chờ, hãy viết bài từ dữ liệu livescore.]`;
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return `[Firecrawl trả về response không phải JSON. Kiểm tra API key.]`;
  }

  const d = data as { success?: boolean; data?: unknown; error?: string };
  if (d.success === false) {
    return `[Firecrawl báo lỗi: ${d.error ?? "(no error message)"}. Kiểm tra API key trong Settings → LLM → Search backend.]`;
  }

  const results = Array.isArray(d.data) ? (d.data as FirecrawlResult[]) : [];
  if (results.length === 0) {
    return `[Firecrawl không trả về kết quả nào cho query: "${query}". Hãy đổi góc query hoặc viết bài từ dữ liệu livescore.]`;
  }

  return formatFirecrawlResults(query, results);
}

interface FirecrawlResult {
  url?: string;
  title?: string;
  description?: string;
  markdown?: string;
  metadata?: { title?: string; description?: string; sourceURL?: string };
}

function formatFirecrawlResults(query: string, results: FirecrawlResult[]): string {
  const lines: string[] = [];
  lines.push(`[Web search results for: "${query}"]`);
  lines.push(`(Source: Firecrawl /v2/search — top ${results.length} results with full markdown content)`);
  lines.push(`(Dùng để verify tỷ số: trích thông tin từ markdown để cross-check với dữ liệu livescore bên dưới.)`);
  lines.push(``);
  results.forEach((r, i) => {
    const title = r.title || r.metadata?.title || "(no title)";
    const url = r.url || r.metadata?.sourceURL || "";
    const description = r.description || r.metadata?.description || "";
    const md = (r.markdown || "").trim();

    lines.push(`${i + 1}. ${title}`);
    lines.push(`   URL: ${url}`);
    if (description) {
      lines.push(`   Description: ${description}`);
    }
    if (md) {
      const truncated = md.length > FIRECRAWL_MAX_MARKDOWN_CHARS;
      const snippet = truncated ? md.slice(0, FIRECRAWL_MAX_MARKDOWN_CHARS) + "… [truncated]" : md;
      lines.push(`   Content (markdown, ${md.length} chars${truncated ? `, truncated to ${FIRECRAWL_MAX_MARKDOWN_CHARS}` : ""}):`);
      lines.push(`   ${snippet.split("\n").join("\n   ")}`);
    } else {
      lines.push(`   Content: (no markdown — scrape may have failed for this URL)`);
    }
    lines.push(``);
  });
  return lines.join("\n");
}

// Module-scoped reference to the current LLM config — set by
// callAnthropic before each request so the tool executor (which runs
// in a nested Promise.all) can read search settings.
let currentLLMConfig: LLMConfig | null = null;

async function runSerpApiSearch(query: string, apiKey: string): Promise<string> {
  const searchTimeoutMs = 10_000;
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}&num=5`;
  return runJsonSearch({
    url,
    timeoutMs: searchTimeoutMs,
    providerName: "SerpAPI",
    parseResults: (data: unknown) => {
      const organic = Array.isArray((data as { organic_results?: unknown[] })?.organic_results)
        ? (data as { organic_results: Array<{ title?: string; link?: string; snippet?: string }> }).organic_results
        : [];
      return organic.slice(0, 5).map((r) => ({
        title: r.title || "",
        snippet: r.snippet || "",
        url: r.link || "",
        source: extractSource(r.link || ""),
      }));
    },
    errorHint: `Vào Settings → LLM → Search backend → chọn "DuckDuckGo" (free, dev-only) hoặc kiểm tra lại SerpAPI key.`,
  });
}

async function runBraveSearch(query: string, apiKey: string): Promise<string> {
  const searchTimeoutMs = 10_000;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  return runJsonSearch({
    url,
    timeoutMs: searchTimeoutMs,
    providerName: "Brave Search",
    extraHeaders: { "X-Subscription-Token": apiKey, Accept: "application/json" },
    parseResults: (data: unknown) => {
      const web = Array.isArray((data as { web?: { results?: unknown[] } })?.web?.results)
        ? (data as { web: { results: Array<{ title?: string; url?: string; description?: string }> } }).web.results
        : [];
      return web.slice(0, 5).map((r) => ({
        title: r.title || "",
        snippet: r.description || "",
        url: r.url || "",
        source: extractSource(r.url || ""),
      }));
    },
    errorHint: `Vào Settings → LLM → Search backend → chọn "DuckDuckGo" (free, dev-only) hoặc kiểm tra lại Brave key.`,
  });
}

interface JsonSearchOptions {
  url: string;
  timeoutMs: number;
  providerName: string;
  extraHeaders?: Record<string, string>;
  parseResults: (data: unknown) => SearchResult[];
  errorHint: string;
}

async function runJsonSearch(opts: JsonSearchOptions): Promise<string> {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: "GET",
      headers: { Accept: "application/json", ...(opts.extraHeaders ?? {}) },
      signal: timeoutController.signal,
    });
  } catch (e) {
    window.clearTimeout(timeoutId);
    if (e instanceof DOMException && e.name === "AbortError") {
      return `[${opts.providerName} timeout (${(opts.timeoutMs / 1000).toFixed(0)}s) cho query. Vui lòng thử lại.]`;
    }
    return `[${opts.providerName} lỗi mạng: ${e instanceof Error ? e.message : String(e)}. Hãy viết bài từ dữ liệu livescore.]`;
  }
  window.clearTimeout(timeoutId);

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error || body?.message || "";
    } catch {
      /* ignore */
    }
    return `[${opts.providerName} HTTP ${res.status}${detail ? `: ${detail}` : ""}. ${opts.errorHint}]`;
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return `[${opts.providerName} trả về response không phải JSON. ${opts.errorHint}]`;
  }

  const results = opts.parseResults(data);
  if (results.length === 0) {
    return `[${opts.providerName} không trả về kết quả nào. Hãy đổi góc query hoặc viết bài từ dữ liệu livescore.]`;
  }
  return formatSearchResults(`<query>`, opts.providerName, results);
}

/**
 * DuckDuckGo HTML — free, dev-only via Vite proxy.
 * DDG aggressively blocks non-browser IPs; often returns CAPTCHA.
 * Kept as a fallback for users who don't have a paid API key.
 */
async function runDuckDuckGoSearch(query: string): Promise<string> {
  const isDev = typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
  if (!isDev) {
    return [
      `[DuckDuckGo chỉ khả dụng trong dev mode (qua Vite proxy)]`,
      ``,
      `Để verify tỷ số trong production: vào Settings → LLM → Search backend → chọn "SerpAPI" hoặc "Brave Search" + điền API key.`,
      ``,
      `Trong lúc chờ, hãy viết bài từ dữ liệu livescore và ghi "chưa cross-check được".`,
    ].join("\n");
  }

  const searchTimeoutMs = 10_000;
  const searchUrl = `/search-proxy/?q=${encodeURIComponent(query)}`;
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), searchTimeoutMs);

  let res: Response;
  try {
    res = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: timeoutController.signal,
    });
  } catch (e) {
    window.clearTimeout(timeoutId);
    if (e instanceof DOMException && e.name === "AbortError") {
      return `[DuckDuckGo timeout (${(searchTimeoutMs / 1000).toFixed(0)}s). Hãy thử lại hoặc cấu hình SerpAPI/Brave trong Settings.]`;
    }
    return `[DuckDuckGo lỗi mạng: ${e instanceof Error ? e.message : String(e)}. Hãy viết bài từ dữ liệu livescore.]`;
  }
  window.clearTimeout(timeoutId);

  if (!res.ok) {
    return `[DuckDuckGo HTTP ${res.status}. Hãy viết bài từ dữ liệu livescore hoặc cấu hình SerpAPI/Brave trong Settings.]`;
  }

  const html = await res.text();

  // DDG returns the "Unfortunately, bots use DuckDuckGo too" page
  // when it detects automated traffic from the IP. The page is short
  // (~14K) and has no `.result` blocks. Tell the user to configure
  // a real search API.
  if (html.includes("Unfortunately, bots use DuckDuckGo")) {
    return [
      `[DuckDuckGo từ chối request từ IP này (anti-bot: "Unfortunately, bots use DuckDuckGo too") — đây là hạn chế thường gặp khi scrape DDG từ non-browser context.]`,
      ``,
      `Để bật verify tỷ số thật, hãy cấu hình search backend trong Settings:`,
      `- SerpAPI (free tier 100/tháng, recommended): https://serpapi.com/`,
      `- Brave Search (free tier 2000/tháng): https://brave.com/search/api/`,
      ``,
      `Query mà model đã gửi: "${query}"`,
      `Trong lúc chờ, hãy viết bài từ dữ liệu livescore và ghi "chưa cross-check được".`,
    ].join("\n");
  }

  const results = parseDuckDuckGoResults(html);
  if (results.length === 0) {
    return `[Không tìm thấy kết quả nào cho query: "${query}". Hãy đổi góc query hoặc viết bài từ dữ liệu livescore.]`;
  }

  return formatSearchResults(query, "DuckDuckGo HTML", results);
}

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  source: string;
}

/**
 * Parse DuckDuckGo HTML response into a list of search results.
 * DDG's HTML class names have been stable for years; this works
 * on the layout I observed (May 2026+):
 *   .result > .result__body > .result__title > a.result__a
 *                                  > .result__extras > .result__url
 *                                  > a.result__snippet
 */
function parseDuckDuckGoResults(html: string): SearchResult[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const resultBlocks = doc.querySelectorAll(".result");
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const block of Array.from(resultBlocks)) {
    const titleEl = block.querySelector("a.result__a");
    if (!titleEl) continue;
    const title = (titleEl.textContent || "").trim();
    if (!title || title.length < 5) continue;

    const href = titleEl.getAttribute("href") || "";
    const realUrl = extractDuckDuckGoRealUrl(href);
    if (!realUrl || seen.has(realUrl)) continue;
    seen.add(realUrl);

    const snippetEl = block.querySelector("a.result__snippet");
    const snippet = snippetEl
      ? stripHtmlTags(snippetEl.textContent || "").trim()
      : "";

    results.push({
      title,
      snippet,
      url: realUrl,
      source: extractSource(realUrl),
    });
  }
  return results;
}

/**
 * DuckDuckGo wraps every result URL through a redirect:
 *   //duckduckgo.com/l/?uddg=<encoded-real-url>&rut=<token>
 * Extract and decode the real URL.
 */
function extractDuckDuckGoRealUrl(duckHref: string): string {
  try {
    if (duckHref.includes("uddg=")) {
      const m = duckHref.match(/uddg=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
    if (duckHref.startsWith("http")) return duckHref;
    if (duckHref.startsWith("//")) return "https:" + duckHref;
  } catch {
    /* fall through */
  }
  return duckHref;
}

function extractSource(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function stripHtmlTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSearchResults(query: string, provider: string, results: SearchResult[]): string {
  const lines: string[] = [];
  lines.push(`[Web search results for: "${query}"]`);
  lines.push(`(Source: ${provider} — top ${results.length} results)`);
  lines.push(`(Dùng để verify tỷ số: nếu snippet ghi rõ "6-2, 6-3" hoặc tương tự thì đó là nguồn web thứ 2 để cross-check với livescore.)`);
  lines.push(``);
  results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   Snippet: ${r.snippet || "(no snippet)"}`);
    lines.push(`   Source: ${r.source}`);
    lines.push(`   URL: ${r.url}`);
    lines.push(``);
  });
  return lines.join("\n");
}
