#!/usr/bin/env node
// End-to-end test of the Firecrawl /v2/search integration.
// Run: FIRECRAWL_API_KEY=fc-... node scripts/test-firecrawl.mjs
//
// This script:
//   1. Calls Firecrawl /v2/search with the real de Minaur vs Hewitt query
//   2. Validates the response shape matches what our executor expects
//   3. Formats the result the same way our runFirecrawlSearch() would
//   4. Prints the EXACT tool_result string that would be sent to the LLM
//
// This is the same path the app takes when the LLM calls web_search —
// just wired to the network instead of mocked.

const API_KEY = process.env.FIRECRAWL_API_KEY;
if (!API_KEY) {
  console.error("❌ Set FIRECRAWL_API_KEY first:");
  console.error("   FIRECRAWL_API_KEY=fc-... node scripts/test-firecrawl.mjs");
  process.exit(1);
}

const QUERY = "flashscore de Minaur vs Hewitt Mubadala Citi DC Open 2026 score set scores";
const URL = "https://api.firecrawl.dev/v2/search";
const MAX_MARKDOWN_CHARS = 1500;

const requestBody = {
  query: QUERY,
  limit: 5,
  scrapeOptions: { formats: ["markdown"] },
};

console.log("━".repeat(72));
console.log("FIRECRAWL TEST — Alex de Minaur vs Cruz Hewitt (Flashscore as source #2)");
console.log("━".repeat(72));
console.log("");
console.log("Query targets Flashscore specifically (per new prompt requirement).");
console.log("Expected: top 5 results should include flashscore.com URLs.");
console.log("");
console.log("→ POST", URL);
console.log("→ Authorization: Bearer", API_KEY.slice(0, 8) + "...");
console.log("→ Body:", JSON.stringify(requestBody, null, 2));
console.log("");

const startedAt = Date.now();
const res = await fetch(URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify(requestBody),
});
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

console.log("← HTTP", res.status, "in", elapsed + "s");
console.log("");

if (!res.ok) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error || body?.message || JSON.stringify(body);
  } catch {
    /* ignore */
  }
  console.error("❌ Firecrawl returned error:", detail);
  console.error("");
  console.error("Troubleshooting:");
  console.error("  - Check API key is valid: https://www.firecrawl.dev/app/api-keys");
  console.error("  - Check credit balance (free tier = 500 credits)");
  console.error("  - Check Firecrawl status: https://firecrawl.betteruptime.com");
  process.exit(1);
}

const data = await res.json();

if (data.success === false) {
  console.error("❌ Firecrawl reported failure:", data.error);
  process.exit(1);
}

const results = Array.isArray(data.data) ? data.data : [];
console.log("✓ Got", results.length, "results");
console.log("");

// ─── Validate against our parser expectations ───────────────────────────
console.log("━━━ PARSER VALIDATION ━━━");
results.forEach((r, i) => {
  const title = r.title || r.metadata?.title || "(no title)";
  const url = r.url || r.metadata?.sourceURL || "";
  const description = r.description || r.metadata?.description || "";
  const md = (r.markdown || "").trim();

  const checks = [
    ["title", !!title && title.length >= 5],
    ["url", !!url],
    ["description", !!description],
    ["markdown", md.length > 0],
  ];
  const passed = checks.every(([_, ok]) => ok);
  console.log(`  Result ${i + 1}: ${passed ? "✓" : "✗"} ${title.slice(0, 60)}`);
  checks.forEach(([name, ok]) => {
    if (!ok) console.log(`    ✗ missing/empty: ${name}`);
  });
  if (md) {
    const truncated = md.length > MAX_MARKDOWN_CHARS;
    console.log(`    markdown: ${md.length} chars${truncated ? ` → will be truncated to ${MAX_MARKDOWN_CHARS}` : ""}`);
  }
});
console.log("");

// ─── Format the exact tool_result string ────────────────────────────────
function formatFirecrawlResults(query, results) {
  const lines = [];
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
      const truncated = md.length > MAX_MARKDOWN_CHARS;
      const snippet = truncated ? md.slice(0, MAX_MARKDOWN_CHARS) + "… [truncated]" : md;
      lines.push(`   Content (markdown, ${md.length} chars${truncated ? `, truncated to ${MAX_MARKDOWN_CHARS}` : ""}):`);
      lines.push(`   ${snippet.split("\n").join("\n   ")}`);
    } else {
      lines.push(`   Content: (no markdown — scrape may have failed for this URL)`);
    }
    lines.push(``);
  });
  return lines.join("\n");
}

const toolResult = formatFirecrawlResults(QUERY, results);

console.log("━━━ EXACT tool_result STRING SENT TO LLM ━━━");
console.log("");
console.log(toolResult);
console.log("");

// ─── Verify the score "6-2, 6-3" appears in the results ────────────────
console.log("━━━ SCORE VERIFICATION ━━━");
const allText = JSON.stringify(data);
const expectedScorePattern = /6[-– ]2[, ]+6[-– ]3|6-2.*6-3|defeated.*6-2.*6-3/i;
if (expectedScorePattern.test(allText)) {
  console.log("✓ Found expected score (6-2, 6-3) in the results");
  console.log("  → 2-source cross-check is possible");
} else {
  console.log("⚠ Did not find expected score (6-2, 6-3) in the results");
  console.log("  → Either score is different, or search didn't return score");
  console.log("  → LLM will fall back to writing from livescore data only");
}
console.log("");

// ─── Verify Flashscore is in the results ──────────────────────────────
console.log("━━━ FLASHSCORE SOURCE CHECK ━━━");
const flashscoreResults = results.filter((r) => {
  const url = (r.url || r.metadata?.sourceURL || "").toLowerCase();
  return url.includes("flashscore.com") || url.includes("flashscore.");
});
if (flashscoreResults.length > 0) {
  console.log(`✓ Found ${flashscoreResults.length} Flashscore result(s) — 2-source verify will use this`);
  flashscoreResults.forEach((r, i) => {
    const title = r.title || r.metadata?.title || "(no title)";
    const url = r.url || r.metadata?.sourceURL || "";
    console.log(`  ${i + 1}. ${title}`);
    console.log(`     ${url}`);
  });
} else {
  console.log("⚠ No Flashscore results in top 5");
  console.log("  → LLM will fall back to Sofascore / ATP Tour / BBC / ESPN");
  console.log("  → Verify the search query — try adding 'site:flashscore.com' or just 'flashscore score'");
  console.log("  → All result URLs:");
  results.forEach((r, i) => {
    const url = r.url || r.metadata?.sourceURL || "";
    console.log(`     ${i + 1}. ${url}`);
  });
}
console.log("");

// ─── Credit usage estimate ──────────────────────────────────────────────
console.log("━━━ CREDIT USAGE ━━━");
const credits = Math.ceil(results.length / 10) * 2;
console.log(`This search used ~${credits} credits (2 per 10 results)`);
console.log(`Free tier = 500 credits → ~${Math.floor(500 / credits)} more searches possible`);
console.log("");

console.log("━".repeat(72));
console.log("✓ TEST COMPLETE");
console.log("━".repeat(72));
console.log("");
console.log("Next steps:");
console.log("  1. Make sure the same key is in browser: Settings → LLM → Search backend");
console.log("  2. Trigger a match completion in watchlist");
console.log("  3. DevTools console will show: [llm] web_search called: \"de Minaur vs Hewitt...\"");
console.log("  4. After tool result comes back, LLM writes report with cite 'theo livescore và <source>'");
