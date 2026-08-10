// Regression test for the production LLM proxy boundary.
// Run with: npx tsx scripts/test-llm-proxy.ts

import { callLLM, isLLMConfigured } from "../src/api/llm";
import type { LLMConfig } from "../src/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { hostname: "tennis-report-hub.vercel.app" } },
  });
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({
      id: "test-message",
      type: "message",
      role: "assistant",
      model: "MiniMax-M3",
      content: [{ type: "text", text: "Bản tin kiểm thử đủ dài để đi qua đường gọi LLM bằng proxy phía máy chủ.".repeat(4) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const config: LLMConfig = {
    enabled: true,
    provider: "anthropic",
    baseUrl: "https://api.minimax.io/anthropic",
    apiKey: "",
    model: "MiniMax-M3",
    maxTokens: 500,
    enableThinking: true,
    enableWebSearch: false,
  };

  try {
    assert(isLLMConfigured(config), "production proxy config without a browser API key must be available to report generation");
    const result = await callLLM({ prompt: "Viết một bản tin kiểm thử.", config, disableTools: true });
    assert(requestedUrl === "/api/llm/v1/messages", `expected production proxy URL, got ${requestedUrl}`);
    assert(requestedHeaders?.get("x-api-key") === null, "browser must not send an LLM API key to the server proxy");
    assert(result.finishReason === "end_turn", `expected end_turn, got ${result.finishReason}`);
    console.log("✅ production proxy accepts an Anthropic config without a browser API key");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
