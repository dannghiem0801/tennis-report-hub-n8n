import { chromium } from "playwright";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newContext().then((c) => c.newPage());
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const result = await page.evaluate(() => {
    const w = window as unknown as { __vite_env__?: Record<string, string>; import?: { meta?: { env?: Record<string, string> } } };
    const env = w.import?.meta?.env;
    const storage = Object.keys(localStorage).filter((k) => k.startsWith("trh:"));
    const ls: Record<string, unknown> = {};
    for (const k of storage) {
      try {
        const raw = localStorage.getItem(k);
        if (raw && raw.length < 500) ls[k] = JSON.parse(raw);
      } catch {}
    }
    return {
      hasImport: typeof w.import !== "undefined",
      hasEnv: !!env,
      envKeys: env ? Object.keys(env) : null,
      llmPrefix: env?.VITE_LLM_API_KEY?.slice(0, 8) ?? null,
      searchPrefix: env?.VITE_LLM_SEARCH_API_KEY?.slice(0, 8) ?? null,
      ls,
    };
  });
  console.log("browser env:", JSON.stringify(result, null, 2));
  await browser.close();
})();
