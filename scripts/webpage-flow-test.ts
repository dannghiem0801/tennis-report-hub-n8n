// End-to-end test that mirrors the user's flow:
// 1. Open dashboard, navigate to a date with completed matches
// 2. Add 5 matches to watchlist
// 3. Open each watchlist entry to trigger generation
// 4. Capture every error, network failure, and per-match outcome

import { chromium } from "playwright";
import fs from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

interface BugReport {
  type: "page_error" | "network_error" | "console_error";
  message: string;
  at: string;
}

interface MatchResult {
  matchId: string;
  side1: string;
  side2: string;
  score: string;
  status: "ready" | "needs-review" | "errored" | "in-progress";
  articleChars: number;
  firstCallMs: number;
  blockingIssues: string[];
  sourceMode: string;
  evidenceIdsUsed: string[];
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const bugs: BugReport[] = [];
  const observations: string[] = [];
  const results: MatchResult[] = [];

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[vite]") || text.includes("React DevTools")) return;
    if (msg.type() === "error") {
      bugs.push({ type: "console_error", message: text, at: new Date().toISOString() });
    }
    if (msg.type() === "warning") {
      observations.push(`[warn] ${text.slice(0, 200)}`);
    }
    // Capture pipeline observability.
    if (text.includes("[generate]") || text.includes("[firecrawl]") || text.includes("[llm]")) {
      observations.push(`[${new Date().toISOString().slice(11, 19)}] ${text.slice(0, 300)}`);
    }
  });
  page.on("pageerror", (err) => {
    bugs.push({ type: "page_error", message: err.message, at: new Date().toISOString() });
  });
  page.on("response", (resp) => {
    if (resp.status() >= 400 && !resp.url().includes("__open-in-editor")) {
      bugs.push({
        type: "network_error",
        message: `HTTP ${resp.status()} ${resp.url()}`,
        at: new Date().toISOString(),
      });
    }
  });

  // Helper: capture generation outcome from a single match.
  async function generateForMatch(matchId: string): Promise<MatchResult> {
    const start = Date.now();
    // Open the report viewer by clicking the watchlist entry.
    // Wait for the article text to appear (up to 5 minutes).
    let articleText = "";
    let badges = "";
    let issues: string[] = [];
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(5000);
      articleText = await page.locator("article").first().textContent().catch(() => "");
      badges = await page.locator("[role='dialog'] [class*='badge']").allTextContents().catch(() => []);
      // Look for "Cần duyệt" badge indicating a blocking issue.
      const hasNeedsReview = badges.some((b) => b.includes("Cần duyệt"));
      const hasReady = badges.some((b) => b.includes("Sẵn sàng"));
      if (hasReady || hasNeedsReview || articleText.length > 200) {
        break;
      }
    }
    const firstCallMs = Date.now() - start;
    const hasReady = badges.some((b) => b.includes("Sẵn sàng"));
    const hasNeedsReview = badges.some((b) => b.includes("Cần duyệt"));
    return {
      matchId,
      side1: "(unknown)",
      side2: "(unknown)",
      score: "?",
      status: articleText.length < 50 ? "errored" : (hasReady ? "ready" : "needs-review"),
      articleChars: articleText.length,
      firstCallMs,
      blockingIssues: issues,
      sourceMode: badges.find((b) => b.includes("livescore")) ? "api-plus-web" : "api-only",
      evidenceIdsUsed: [],
    };
  }

  await page.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  console.log("[flow] Page loaded. Default date should be today.");

  // The dashboard might already be on today's date with live matches.
  // For 5 completed matches we need an older date. Switch to 2026-08-09.
  await page.evaluate(() => {
    const input = document.querySelector('input[type="date"]') as HTMLInputElement | null;
    if (!input) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    nativeSetter?.call(input, "2026-08-09");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(5000);

  // Take initial screenshot.
  await page.screenshot({ path: "/tmp/flow-01-dashboard.png", fullPage: true });

  const finishedCount = await page.locator("text=FINISHED").count();
  console.log(`[flow] FINISHED matches on 2026-08-09: ${finishedCount}`);

  if (finishedCount === 0) {
    console.log("[flow] No completed matches. Switching to 2026-08-08");
    await page.evaluate(() => {
      const input = document.querySelector('input[type="date"]') as HTMLInputElement | null;
      if (!input) return;
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(input, "2026-08-08");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "/tmp/flow-02-dashboard-08.png", fullPage: true });
  }

  // Add 5 matches to watchlist by clicking stars on rows with FINISHED status.
  const targetsAdded: string[] = [];
  for (let i = 0; i < 5; i++) {
    const finished = page.locator("text=FINISHED");
    const c = await finished.count();
    if (i >= c) {
      console.log(`[flow] Only ${c} FINISHED rows available, stopping at ${i}`);
      break;
    }
    const badge = finished.nth(i);
    const row = badge.locator("xpath=ancestor::div[descendant::button[descendant::svg[@class='lucide-star']]][1]");
    const star = row.locator("button").filter({ has: page.locator("svg.lucide-star") }).first();
    if (await star.count() > 0) {
      await star.click();
      await page.waitForTimeout(500);
      // Read the localStorage to confirm.
      const ls = await page.evaluate(() => JSON.parse(localStorage.getItem("trh:tennis:watchlist") || "[]"));
      const last = ls[ls.length - 1];
      if (last) targetsAdded.push(`${last.side1Name} vs ${last.side2Name} (${last.matchApiId})`);
    }
  }
  console.log(`[flow] Added ${targetsAdded.length} matches: ${JSON.stringify(targetsAdded)}`);

  await page.waitForTimeout(2000);
  await page.screenshot({ path: "/tmp/flow-03-watchlisted.png", fullPage: true });

  // Switch to Báo cáo tab to see the watchlist.
  const reportsTab = page.locator("button:has-text('Báo cáo')").first();
  if (await reportsTab.count() > 0) {
    await reportsTab.click();
    await page.waitForTimeout(2000);
  }
  // Click Đang chờ pending tab.
  const pendingTab = page.locator("button:has-text('Đang chờ')").first();
  if (await pendingTab.count() > 0) {
    await pendingTab.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: "/tmp/flow-04-pending-tab.png", fullPage: true });

  // Now iterate through sidebar entries, click each, capture outcome.
  const entries = await page.locator(".cursor-pointer").count();
  console.log(`[flow] Sidebar clickable entries: ${entries}`);

  for (let i = 0; i < Math.min(5, entries); i++) {
    console.log(`\n[flow] === Generating match ${i + 1}/5 ===`);
    // Find the i-th entry by aria-position or by index.
    const entry = page.locator(".cursor-pointer").nth(i);
    const entryText = await entry.textContent().catch(() => "");
    console.log(`[flow] Entry #${i + 1}: ${entryText?.slice(0, 80)}`);
    await entry.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `/tmp/flow-05-viewer-${i + 1}.png`, fullPage: true });

    const result = await generateForMatch(`match-${i + 1}`);
    result.side1 = entryText?.split("vs")[0]?.trim() ?? "?";
    result.side2 = entryText?.split("vs")[1]?.trim() ?? "?";
    results.push(result);

    // Close the dialog so we can click the next entry.
    const closeBtn = page.locator("[role='dialog'] button").first();
    if (await closeBtn.count() > 0) {
      await closeBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    // Re-click Đang chờ tab if we got bumped out.
    const stillPending = page.locator("button:has-text('Đang chờ')").first();
    if (await stillPending.count() > 0) {
      await stillPending.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }

  await page.screenshot({ path: "/tmp/flow-99-final.png", fullPage: true });

  // Final summary.
  console.log("\n========= FLOW SUMMARY =========");
  console.log(`Matches targeted: ${targetsAdded.length}`);
  console.log(`Generation results: ${results.length}`);
  for (const r of results) {
    console.log(`  ${r.matchId}  ${r.side1} vs ${r.side2}  status=${r.status}  article=${r.articleChars}c  ${r.firstCallMs/1000}s`);
  }
  console.log(`\nBugs detected: ${bugs.length}`);
  for (const b of bugs.slice(0, 20)) {
    console.log(`  [${b.type}] ${b.message.slice(0, 200)}`);
  }
  console.log(`\nObservations (last 30):`);
  for (const o of observations.slice(-30)) console.log(`  ${o}`);

  // Save full report.
  fs.writeFileSync("/tmp/flow-results.json", JSON.stringify({
    targetsAdded,
    results,
    bugs,
    observations,
    finishedAt: new Date().toISOString(),
  }, null, 2));

  await browser.close();

  if (bugs.length > 0) {
    console.log("\n[flow] FAIL: bugs detected");
    process.exit(2);
  }
  console.log("\n[flow] DONE");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
