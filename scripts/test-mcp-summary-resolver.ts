import { resolveRequestedToolName } from "../api/mcp/enrich";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  resolveRequestedToolName(
    "Get_Match_Summary",
    ["Get_Match_Summary", "Get_Match_Details"],
    new Set(["Get_Match_Summary", "Get_Match_Details"])
  ) === "Get_Match_Summary",
  "uses a configured dedicated summary tool when RapidAPI exposes it"
);

assert(
  resolveRequestedToolName(
    "Get_Match_Summary",
    ["Get_Match_Details"],
    new Set(["Get_Match_Details"])
  ) === "Get_Match_Details",
  "falls back to configured match details when no summary tool is available"
);

assert(
  resolveRequestedToolName("Get_Match_Stats", ["Get_Match_Stats"], new Set(["Get_Match_Stats"])) === "Get_Match_Stats",
  "does not rewrite other allowlisted tools"
);

console.log("✅ Football summary tool resolution is safe and deterministic");
