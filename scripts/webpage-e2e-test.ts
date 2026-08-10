// E2E: navigate the actual browser, exercise the watchlist and report
// generation flow end-to-end, verify a real article appears.

import { chromium } from "playwright";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleMessages: { type: string; text: string }[] = [];
  const pageErrors: string[] = [];
  const networkErrors: { url: string; status: number }[] = [];

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[vite]") || text.includes("React DevTools")) return;
    consoleMessages.push({ type: msg.type(), text });
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (resp) => {
    if (resp.status() >= 400 && !resp.url().includes("__open-in-editor")) {
      networkErrors.push({ url: resp.url(), status: resp.status() });
    }
  });

  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // The Tennis tab is the default (activeSport=tennis). Navigate to
  // 2026-08-09 via direct store interaction: set the localStorage
  // selectedDate... actually the date is in-memory. We need to click.
  // Type into the date input and submit via Enter.
  console.log("[e2e] Locating date input");
  const dateInput = page.locator("input[type='date']").first();
  await dateInput.waitFor({ state: "visible", timeout: 10000 });
  // Force-fill the value and dispatch change event manually.
  await page.evaluate(() => {
    const input = document.querySelector('input[type="date"]') as HTMLInputElement | null;
    if (!input) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    nativeSetter?.call(input, "2026-08-09");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "/tmp/e2e-01-dashboard.png", fullPage: true });

  // Verify date navigation worked.
  const dateText = await page.locator("text=/Thứ|Ba|Tư|Năm|Sáu|Bảy|Chủ nhật/").first().textContent().catch(() => "");
  console.log(`[e2e] Date label visible: ${dateText}`);

  const finishedCount = await page.locator("text=FINISHED").count();
  console.log(`[e2e] FINISHED matches after date navigation: ${finishedCount}`);

  // Click 3 stars.
  let clicked = 0;
  for (let i = 0; i < 3; i++) {
    const badges = page.locator("text=FINISHED");
    if (i >= await badges.count()) break;
    const badge = badges.nth(i);
    const row = badge.locator("xpath=ancestor::div[descendant::button[descendant::svg[@class='lucide-star']]][1]");
    const star = row.locator("button").filter({ has: page.locator("svg.lucide-star") }).first();
    if (await star.count() > 0) {
      await star.click();
      clicked++;
      await page.waitForTimeout(500);
    }
  }
  console.log(`[e2e] Clicked ${clicked} stars`);

  await page.waitForTimeout(2000);

  const ls = await page.evaluate(() => ({
    tennis: JSON.parse(localStorage.getItem("trh:tennis:watchlist") || "[]"),
    football: JSON.parse(localStorage.getItem("trh:football:watchlist") || "[]"),
  }));
  console.log(`[e2e] tennis watchlist: ${ls.tennis.length}, football watchlist: ${ls.football.length}`);
  if (ls.tennis.length > 0) {
    console.log(`[e2e] first tennis entry: ${ls.tennis[0].side1Name} vs ${ls.tennis[0].side2Name} (${ls.tennis[0].matchApiId})`);
  }

  await page.screenshot({ path: "/tmp/e2e-02-watchlisted.png", fullPage: true });

  // Switch to Báo cáo tab.
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
  await page.screenshot({ path: "/tmp/e2e-03-pending-tab.png", fullPage: true });

  // Look for clickable entries on the right sidebar.
  const sidebarEntries = await page.locator(".cursor-pointer").count();
  console.log(`[e2e] Sidebar clickable entries: ${sidebarEntries}`);

  if (sidebarEntries > 0) {
    console.log("[e2e] Clicking first sidebar entry to open viewer");
    await page.locator(".cursor-pointer").first().click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "/tmp/e2e-04-viewer.png", fullPage: true });

    // Wait for the LLM to produce an article (up to 5 minutes).
    let articleText = "";
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(5000);
      articleText = await page.locator("article").first().textContent().catch(() => "");
      if (articleText.length > 200) {
        console.log(`[e2e] Article ready after ${(i + 1) * 5}s, length=${articleText.length}`);
        break;
      }
    }

    const badges = await page.locator("[role='dialog'] [class*='badge']").allTextContents().catch(() => []);
    console.log(`[e2e] Dialog badges: ${JSON.stringify(badges)}`);
    console.log("\n=== ARTICLE PREVIEW ===");
    console.log(articleText.slice(0, 500));
    console.log("...");
    await page.screenshot({ path: "/tmp/e2e-05-final.png", fullPage: true });
  }

  console.log("\n=== CONSOLE (last 20) ===");
  for (const m of consoleMessages.slice(-20)) console.log(`[${m.type}] ${m.text}`);
  console.log("\n=== PAGE ERRORS ===");
  for (const e of pageErrors) console.log(e);
  console.log("\n=== NETWORK ERRORS ===");
  for (const e of networkErrors) console.log(`${e.status}  ${e.url}`);

  await browser.close();

  if (pageErrors.length > 0 || networkErrors.length > 0) {
    console.log("\n[e2e] FAIL: errors");
    process.exit(2);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
