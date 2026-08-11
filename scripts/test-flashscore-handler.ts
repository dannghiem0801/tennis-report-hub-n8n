import { getRapidApiKey } from "../api/flashscore-handler";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  getRapidApiKey({ RAPID_API_KEY: "", RAPID_MCP_API_KEY: "mcp-preview-key" }) === "mcp-preview-key",
  "an empty RAPID_API_KEY must not shadow the configured RAPID_MCP_API_KEY"
);
assert(
  getRapidApiKey({ RAPID_API_KEY: "rest-key", RAPID_MCP_API_KEY: "mcp-key" }) === "rest-key",
  "the dedicated REST key must remain preferred when present"
);
assert(
  getRapidApiKey({}) === undefined,
  "missing RapidAPI credentials must be reported as unavailable"
);

console.log("✅ Flashscore proxy selects a non-empty RapidAPI credential");
