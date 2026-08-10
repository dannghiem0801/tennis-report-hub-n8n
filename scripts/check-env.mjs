import { chromium } from "playwright";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newContext().then((c) => c.newPage());
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const result = await page.evaluate(async () => {
    const envMod = await import("/src/lib/env.ts");
    return {
      rapidApiKey: envMod.env.rapidApiKey()?.slice(0, 8),
      llmApiKey: envMod.env.llm.apiKey()?.slice(0, 8),
      llmModel: envMod.env.llm.model(),
      llmBase: envMod.env.llm.baseUrl(),
      llmEnabled: envMod.env.llm.enabled(),
      llmMaxTokens: envMod.env.llm.maxTokens(),
      searchApiKey: envMod.env.search.apiKey()?.slice(0, 8),
      searchProvider: envMod.env.search.provider(),
    };
  });
  console.log("browser env:", JSON.stringify(result, null, 2));
  await browser.close();
})();
