#!/usr/bin/env node
// Test Firecrawl's ability to render Flashscore's JS-heavy page and return
// markdown with the actual match data (score, stats, point-by-point).
// Run: FIRECRAWL_API_KEY=fc-... node scripts/test-flashscore-scrape.mjs

const API_KEY = process.env.FIRECRAWL_API_KEY;
if (!API_KEY) {
  console.error("❌ Set FIRECRAWL_API_KEY first:");
  console.error("   FIRECRAWL_API_KEY=fc-... node scripts/test-flashscore-scrape.mjs");
  process.exit(1);
}

// The Flashscore URL the user gave us for the de Minaur vs Hewitt match
const FLASHSCORE_URL =
  "https://www.flashscore.com/match/tennis/de-minaur-alex-EZgZ9Xfh/hewitt-cruz-pOQrEMUs/?mid=CfsWYAxo";

console.log("━".repeat(72));
console.log("FIRECRAWL SCRAPE TEST — Flashscore match page");
console.log("━".repeat(72));
console.log("");
console.log("This page is JS-rendered (all match data comes from");
console.log("https://2.ds.lsapp.eu/pq_graphql). Firecrawl should render it");
console.log("and return markdown with the actual score, stats, and (if");
console.log("available) point-by-point data.");
console.log("");

// Use Firecrawl's /v2/scrape endpoint — it handles JS rendering
const SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const requestBody = {
  url: FLASHSCORE_URL,
  formats: ["markdown"],
  // Wait for JS to fully render and data to load
  waitFor: 5000, // 5 seconds should be enough for Flashscore
  // Optional: render with a specific timeout
  timeout: 30000,
  // Don't block ads/trackers
  blockAds: true,
  // Keep recent screenshot in case markdown is empty
  // screenshot: false, // default false
};

console.log("→ POST", SCRAPE_URL);
console.log("→ Authorization: Bearer", API_KEY.slice(0, 8) + "...");
console.log("→ Body:", JSON.stringify(requestBody, null, 2));
console.log("");

const startedAt = Date.now();
const res = await fetch(SCRAPE_URL, {
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
  process.exit(1);
}

const data = await res.json();

// Save the full response to a file for inspection
const fs = await import("node:fs");
fs.writeFileSync("/tmp/flashscore-response.json", JSON.stringify(data, null, 2));
console.log("✓ Full response saved to /tmp/flashscore-response.json");
console.log("");

// Extract the markdown content
const markdown = data?.data?.markdown || data?.markdown || "";
const metadata = data?.data?.metadata || data?.metadata || {};

console.log("━━━ RESPONSE SUMMARY ━━━");
console.log(`Markdown length: ${markdown.length} chars`);
if (metadata.title) console.log(`Title: ${metadata.title}`);
if (metadata.description) console.log(`Description: ${metadata.description}`);
console.log("");

console.log("━━━ CONTENT CHECKS ━━━");
const checks = [
  ["Final score (e.g. 6-2, 6-3)", /6[-– ]2[, ]+6[-– ]3|2-0/i],
  ["Player names (de Minaur, Hewitt)", /de\s*minaur|hewitt/i],
  ["Tournament (Mubadala, Washington, DC Open)", /washington|dc\s*open|mubadala/i],
  ["Set-by-set score", /set\s*1|set\s*2|6-2|6-3/i],
  ["Aces / serve stats", /aces?|first\s*serve|service\s*game/i],
  ["Point-by-point data", /point\s*by\s*point|game\s*score|15-0|30-15|40-30/i],
  ["Serve / return percentages", /\d+%|percent/i],
  ["Break points", /break\s*point/i],
];

for (const [name, pattern] of checks) {
  const found = pattern.test(markdown);
  console.log(`  ${found ? "✓" : "✗"} ${name}`);
}
console.log("");

if (markdown.length > 0) {
  console.log("━━━ FIRST 2000 CHARS OF MARKDOWN ━━━");
  console.log("");
  console.log(markdown.slice(0, 2000));
  console.log("");
  if (markdown.length > 2000) {
    console.log(`[... ${markdown.length - 2000} more chars ...]`);
  }
  console.log("");
}

console.log("━".repeat(72));
console.log("✓ TEST COMPLETE");
console.log("━".repeat(72));
console.log("");
console.log("If you see set-by-set scores, aces, break points, etc. —");
console.log("Firecrawl successfully rendered the JS page and we can use it");
console.log("for full point-by-point data.");
console.log("");
console.log("Next step: integrate Firecrawl /v2/scrape into the LLM executor");
console.log("so the model can scrape Flashscore URLs directly when needed.");
