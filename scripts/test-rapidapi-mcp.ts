// Rapid MCP contract tests. Run with: npx tsx scripts/test-rapidapi-mcp.ts
// No credential or network request is required.

import {
  compactToolResult,
  getRapidMcpConfig,
  RapidMcpClient,
  RapidMcpError,
} from "../api/mcp/rapidapi";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`❌ ${name}`);
    console.log(`   ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    RAPID_MCP_ENABLED: "true",
    RAPID_MCP_API_KEY: "test-key",
    RAPID_MCP_ALLOWED_TOOLS: "match_details,match_stats",
    ...overrides,
  };
}

await test("requires feature flag", () => {
  try {
    getRapidMcpConfig(env({ RAPID_MCP_ENABLED: "false" }));
    throw new Error("expected configuration failure");
  } catch (error) {
    assert(error instanceof RapidMcpError && error.status === 503, "expected disabled 503");
  }
});

await test("parses only allowlisted Rapid routing headers", () => {
  const config = getRapidMcpConfig(env({
    RAPID_MCP_REQUEST_HEADERS: '{"x-rapidapi-host":"flashscore4.p.rapidapi.com"}',
    RAPID_MCP_MAX_CALLS: "99",
  }));
  assert(config.maxCallsPerRequest === 4, "max calls should be capped");
  assert(config.extraHeaders["x-rapidapi-host"] === "flashscore4.p.rapidapi.com", "routing header missing");
});

await test("rejects protocol-header override", () => {
  try {
    getRapidMcpConfig(env({ RAPID_MCP_REQUEST_HEADERS: '{"authorization":"Bearer no"}' }));
    throw new Error("expected configuration failure");
  } catch (error) {
    assert(error instanceof RapidMcpError && error.status === 500, "expected invalid header failure");
  }
});

await test("executes initialize, tools/list, and only allowlisted tools", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string; id?: number };
    methods.push(body.method);
    const result = body.method === "tools/list"
      ? { tools: [{ name: "match_details" }] }
      : body.method === "tools/call"
        ? { content: [{ type: "text", text: "ok" }] }
        : { protocolVersion: "2024-11-05" };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  }) as typeof fetch;
  try {
    const client = new RapidMcpClient(getRapidMcpConfig(env()));
    await client.initialize();
    const tools = await client.listTools();
    assert(tools[0]?.name === "match_details", "tool list mismatch");
    const called = await client.callTool("match_details", { match_id: "123" });
    assert(called.content[0]?.text === "ok", "tool result mismatch");
    try {
      await client.callTool("forbidden", {});
      throw new Error("expected forbidden tool failure");
    } catch (error) {
      assert(error instanceof RapidMcpError && error.status === 403, "expected allowlist rejection");
    }
    assert(
      methods.join(",") === "initialize,notifications/initialized,tools/list,tools/call",
      "unexpected RPC sequence"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("bounds tool content before it can enter an evidence envelope", () => {
  const compact = compactToolResult({ content: [{ type: "text", text: "x".repeat(20) }] }, 12);
  assert(compact.includes("Đã cắt bớt"), "expected truncation marker");
  assert(compact.length < 80, "truncated output unexpectedly large");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
