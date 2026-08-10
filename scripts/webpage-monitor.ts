// Webpage monitor: opens the dev server in a headless browser and
// watches for the watchlist to grow to 5 entries, then captures the
// full state of every report as it gets generated.

import { chromium } from "playwright";
import fs from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const STATE_FILE = "/tmp/monitor-state.json";
const REPORT_FILE = "/tmp/monitor-reports.json";

interface MonitorState {
  startedAt: string;
  baselineWatchlist: { tennis: number; football: number };
  baselineReports: { tennis: number; football: number };
  watchlistSamples: Array<{ at: string; tennis: number; football: number; sample: unknown[] }>;
  reports: unknown[];
  consoleErrors: string[];
  consoleWarns: string[];
  pageErrors: string[];
  networkErrors: Array<{ url: string; status: number }>;
  observations: string[];
}

async function main() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ status: "starting" }, null, 2));
  fs.writeFileSync(REPORT_FILE, "[]");

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const state: MonitorState = {
    startedAt: new Date().toISOString(),
    baselineWatchlist: { tennis: 0, football: 0 },
    baselineReports: { tennis: 0, football: 0 },
    watchlistSamples: [],
    reports: [],
    consoleErrors: [],
    consoleWarns: [],
    pageErrors: [],
    networkErrors: [],
    observations: [],
  };

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[vite]") || text.includes("React DevTools")) return;
    if (msg.type() === "error") state.consoleErrors.push(`[${msg.type()}] ${text}`);
    if (msg.type() === "warning") state.consoleWarns.push(`[warn] ${text}`);
    if (msg.type() === "log" && (text.includes("[generate]") || text.includes("[firecrawl]") || text.includes("[llm]"))) {
      // Pipeline observability lines are useful for debugging.
      state.observations.push(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
    }
  });
  page.on("pageerror", (err) => state.pageErrors.push(err.message));
  page.on("response", (resp) => {
    if (resp.status() >= 400 && !resp.url().includes("__open-in-editor")) {
      state.networkErrors.push({ url: resp.url(), status: resp.status() });
    }
  });

  // Connect to the live page (the one the user is interacting with).
  // We use the same browser instance but a separate context so the
  // user's localStorage stays untouched.
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  fs.writeFileSync(STATE_FILE, JSON.stringify({ status: "monitoring", note: "open the user's browser at http://localhost:5173 and add 5 matches" }, null, 2));
  console.log("[monitor] Connected. Watching for watchlist growth…");

  // The monitor is on a different browser context than the user.
  // We poll localStorage every 2 seconds for changes.
  const pollStart = Date.now();
  let lastTennis = 0;
  let lastFootball = 0;
  let lastReportsLen = 0;
  let baselineCaptured = false;

  while (Date.now() - pollStart < 10 * 60 * 1000) {
    await page.waitForTimeout(2000);
    try {
      const ls = await page.evaluate(() => ({
        tennis: JSON.parse(localStorage.getItem("trh:tennis:watchlist") || "[]"),
        football: JSON.parse(localStorage.getItem("trh:football:watchlist") || "[]"),
        reportsTennis: JSON.parse(localStorage.getItem("trh:tennis:reports") || "[]"),
        reportsFootball: JSON.parse(localStorage.getItem("trh:football:reports") || "[]"),
      }));

      const tennisLen = ls.tennis.length;
      const footballLen = ls.football.length;
      const repT = ls.reportsTennis.length;
      const repF = ls.reportsFootball.length;
      const totalW = tennisLen + footballLen;
      const totalR = repT + repF;

      if (!baselineCaptured && totalW === 0) {
        state.baselineWatchlist = { tennis: tennisLen, football: footballLen };
        state.baselineReports = { tennis: repT, football: repF };
        baselineCaptured = true;
      }

      if (tennisLen !== lastTennis || footballLen !== lastFootball) {
        state.watchlistSamples.push({
          at: new Date().toISOString(),
          tennis: tennisLen,
          football: footballLen,
          sample: totalW <= 3 ? ls.tennis.concat(ls.football).slice(0, 3) : [],
        });
        lastTennis = tennisLen;
        lastFootball = footballLen;
        console.log(`[monitor] watchlist: tennis=${tennisLen} football=${footballLen} (total=${totalW})`);
        fs.writeFileSync(STATE_FILE, JSON.stringify({
          status: "watching",
          watchlist: { tennis: tennisLen, football: footballLen },
          reports: { tennis: repT, football: repF },
        }, null, 2));
      }

      if (repT + repF > lastReportsLen) {
        const allReports = [...ls.reportsTennis, ...ls.reportsFootball];
        const newOnes = allReports.slice(lastReportsLen);
        for (const r of newOnes) {
          state.reports.push(r);
          console.log(`[monitor] New report: ${(r as { side1Name?: string }).side1Name} vs ${(r as { side2Name?: string }).side2Name} -> status=${(r as { quality?: { status?: string } }).quality?.status}`);
        }
        lastReportsLen = repT + repF;
        fs.writeFileSync(REPORT_FILE, JSON.stringify(allReports, null, 2));
      }

      // Exit when 5 reports are produced (target).
      if (totalR >= 5) {
        console.log(`[monitor] 5 reports reached. Final summary:`);
        console.log(`  Watchlist: ${tennisLen} tennis + ${footballLen} football = ${totalW}`);
        console.log(`  Reports: ${repT} tennis + ${repF} football = ${totalR}`);
        console.log(`  Page errors: ${state.pageErrors.length}`);
        console.log(`  Network errors: ${state.networkErrors.length}`);
        console.log(`  Console errors: ${state.consoleErrors.length}`);
        console.log(`  Console warnings: ${state.consoleWarns.length}`);
        console.log(`  Observations: ${state.observations.length}`);
        break;
      }
    } catch (e) {
      // Page might be reloading during user interaction; ignore.
    }
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  // Print final summary.
  console.log("\n=== FINAL MONITOR STATE ===");
  console.log(`Watchlist: ${lastTennis} tennis + ${lastFootball} football = ${lastTennis + lastFootball}`);
  console.log(`Reports: ${state.reports.length}`);
  console.log(`Page errors: ${state.pageErrors.length}`);
  for (const e of state.pageErrors) console.log(`  ! ${e}`);
  console.log(`Network errors: ${state.networkErrors.length}`);
  for (const e of state.networkErrors) console.log(`  ! ${e.status} ${e.url}`);
  console.log(`Console errors: ${state.consoleErrors.length}`);
  for (const e of state.consoleErrors) console.log(`  ! ${e}`);

  await browser.close();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
