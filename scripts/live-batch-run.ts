// Live batch run: pick 5 random completed matches for each sport,
// run each through the publication-safe pipeline (Firecrawl +
// LLM draft + validator), and capture timing/status/error.

import fs from "node:fs";
import Module from "node:module";

// 1. Read .env.local BEFORE loading any source module.
const envFile = fs.readFileSync(".env.local", "utf8");
const env: Record<string, string> = {};
for (const line of envFile.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

// 2. Polyfill `import.meta.env` for tsx. We hook Node's module
// loader so every subsequent `import "src/..."` resolves with a
// Vite-shaped import.meta.env.
const viteEnv: Record<string, unknown> = { ...env, DEV: true, MODE: "development", BASE_URL: "/" };
const originalResolve = (Module as unknown as { _resolveFilename?: (req: string, ...rest: unknown[]) => string })._resolveFilename;
if (originalResolve) {
  (Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string })._resolveFilename = function (req: string, ...rest: unknown[]) {
    return originalResolve.call(this, req, ...rest);
  };
}
// Patch the loader's import.meta via globalThis so env.ts finds it.
(globalThis as unknown as { __vite_env__: Record<string, unknown> }).__vite_env__ = viteEnv;

// Now we can safely import the source. Use a CJS proxy to inject the
// import.meta.env values via a tiny shim file.
// Approach: load via dynamic import after assigning to globalThis.
process.env.VITE_LLM_ENABLED = env.VITE_LLM_ENABLED;
process.env.VITE_LLM_PROVIDER = env.VITE_LLM_PROVIDER;
process.env.VITE_LLM_BASE_URL = env.VITE_LLM_BASE_URL;
process.env.VITE_LLM_API_KEY = env.VITE_LLM_API_KEY;
process.env.VITE_LLM_MODEL = env.VITE_LLM_MODEL;
process.env.VITE_LLM_TEMPERATURE = env.VITE_LLM_TEMPERATURE;
process.env.VITE_LLM_MAX_TOKENS = env.VITE_LLM_MAX_TOKENS;
process.env.VITE_LLM_ENABLE_THINKING = env.VITE_LLM_ENABLE_THINKING;
process.env.VITE_LLM_ENABLE_WEB_SEARCH = env.VITE_LLM_ENABLE_WEB_SEARCH;
process.env.VITE_LLM_SEARCH_PROVIDER = env.VITE_LLM_SEARCH_PROVIDER;
process.env.VITE_LLM_SEARCH_API_KEY = env.VITE_LLM_SEARCH_API_KEY;
process.env.VITE_RAPID_API_KEY = env.VITE_RAPID_API_KEY;

// Patch import.meta.env with a Proxy that reads from process.env when
// the key isn't already on viteEnv.
const handler: ProxyHandler<object> = {
  get(_target, prop: string) {
    if (prop in viteEnv) return (viteEnv as Record<string, unknown>)[prop];
    const v = process.env[prop];
    return v === undefined ? undefined : v;
  },
};
// We can't truly patch import.meta.env, but env.ts reads it as a free
// identifier at top-level. So we shim it via a CJS module that re-exports.
// Simplest: replace src/lib/env.ts evaluation by importing a shim.
// Drop the helper in /tmp and import it FIRST so its module evaluation
// installs import.meta.env before env.ts loads.
// Shim `import.meta.env` for tsx by attaching a Proxy to globalThis.
// Source modules read `import.meta.env.VITE_*` at module init; if
// `import.meta.env` is undefined, those reads throw. By exposing a
// Proxy that pulls from process.env, we let source code run as if
// it were inside Vite's dev server. tsx re-uses the same module
// instance, so this shim persists for every subsequent import.
type ImportMetaEnv = Record<string, string | undefined> & { DEV?: boolean; MODE?: string; BASE_URL?: string };
type ImportMetaLike = { env: ImportMetaEnv };
type GlobalWithImport = typeof globalThis & { import?: { meta?: ImportMetaLike } };
const g = globalThis as GlobalWithImport;
const envProxy = new Proxy({} as ImportMetaEnv, {
  get(_t, k: string) {
    if (k === "DEV") return true;
    if (k === "MODE") return "development";
    if (k === "BASE_URL") return "/";
    return process.env[k] === undefined ? undefined : process.env[k];
  },
});
g.import = { ...(g.import ?? {}), meta: { env: envProxy } };

// Now load everything via dynamic import (so the shim runs first).
const { getMatchesByDate, getMatchDetails, getPointByPoint } = await import("../src/api/flashscore");
const { mapMatchesBatch, mapMatchDetails, mapPointByPoint } = await import("../src/api/flashscore-mapper");
const { buildMatchEvidence } = await import("../src/reports/evidence");
const { validateEnvelope, parseEnvelope } = await import("../src/reports/validate");
const { callLLM, LLMError } = await import("../src/api/llm");
const { buildPromptContextWithSources } = await import("../src/reports/templates");
const { fetchMatchSources } = await import("../src/api/firecrawl");
const types = await import("../src/types");
type Match = types.Match;
type TennisMatch = types.TennisMatch;
type FootballMatch = types.FootballMatch;
type LLMConfig = types.LLMConfig;

const apiKey = env.VITE_RAPID_API_KEY ?? "";
const llmConfig: LLMConfig = {
  // Inside Node/tsx we route through the Vite dev proxy so the LLM
  // call lands on the same upstream the browser would use.
  enabled: true,
  provider: (env.VITE_LLM_PROVIDER as "anthropic" | "openai-compatible") ?? "anthropic",
  baseUrl: env.VITE_LLM_BASE_URL
    ? "http://localhost:5173/llm-proxy"
    : "",
  apiKey: env.VITE_LLM_API_KEY ?? "",
  model: env.VITE_LLM_MODEL ?? "",
  maxTokens: Math.min(env.VITE_LLM_MAX_TOKENS ? parseInt(env.VITE_LLM_MAX_TOKENS, 10) : 1_000_000, 524_288),
  temperature: env.VITE_LLM_TEMPERATURE ? parseFloat(env.VITE_LLM_TEMPERATURE) : undefined,
  enableThinking: (env.VITE_LLM_ENABLE_THINKING ?? "true") === "true",
  enableWebSearch: (env.VITE_LLM_ENABLE_WEB_SEARCH ?? "true") === "true",
  searchProvider: (env.VITE_LLM_SEARCH_PROVIDER as "firecrawl" | "duckduckgo" | "serpapi" | "brave") ?? "firecrawl",
  searchApiKey: env.VITE_LLM_SEARCH_API_KEY ?? "",
};

const SPORT_ID: Record<string, number> = { tennis: 2, football: 1 };
const SPORT_LABEL: Record<string, string> = { tennis: "Tennis", football: "Football" };
const MATCHES_PER_SPORT = 5;

interface RunResult {
  sport: string;
  matchId: string;
  side1: string;
  side2: string;
  score: string;
  pipelineMs: number;
  firecrawlMs: number;
  firecrawlSources: number;
  firstCallMs: number;
  firstCallFinish: string;
  firstCallTurns: number;
  validationIssues: { code: string; blocking: boolean; message: string }[];
  blockingCount: number;
  repairAttempted: boolean;
  repairSucceeded?: boolean;
  status: string;
  error?: string;
  articleChars: number;
  evidenceSources: number;
}

async function fetchCompletedMatches(sport: string, lookbackDays: number): Promise<Match[]> {
  const sportId = SPORT_ID[sport];
  const today = new Date();
  const out: Match[] = [];
  for (let i = 1; i <= lookbackDays && out.length < MATCHES_PER_SPORT * 4; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    try {
      const payload = await getMatchesByDate({
        apiKey,
        sportId,
        date: dateKey,
        timezone: "Asia/Ho_Chi_Minh",
      });
      const { matches } = mapMatchesBatch({ payload, dateKey, sport: sport as "tennis" | "football" });
      const completed = matches.filter((m) => m.status === "completed");
      out.push(...completed);
      // eslint-disable-next-line no-console
      console.log(`  [list] ${dateKey} ${sport}: ${matches.length} total, ${completed.length} completed`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`  [list] ${dateKey} ${sport}: list fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

async function enrichTennis(m: TennisMatch): Promise<TennisMatch> {
  try {
    const [detailsRes, pbpRes] = await Promise.allSettled([
      getMatchDetails({ apiKey, matchId: m.id }).then(mapMatchDetails),
      getPointByPoint({ apiKey, matchId: m.id }).then(mapPointByPoint),
    ]);
    const details = detailsRes.status === "fulfilled" ? detailsRes.value : null;
    const pbp = pbpRes.status === "fulfilled" ? pbpRes.value : null;
    const patch: Partial<TennisMatch> = {};
    if (details?.sets && details.sets.length > 0) patch.sets = details.sets;
    if (details?.stats) patch.stats = details.stats;
    if (pbp && pbp.sets.length > 0) patch.pointByPoint = pbp;
    if (Object.keys(patch).length === 0) return m;
    return { ...m, ...patch };
  } catch {
    return m;
  }
}

const TENNIS_PERSONA = `## Vai trò

Bạn là phóng viên thể thao chuyên mảng tennis.

## Quy tắc cứng

1. API là nguồn chính. Mọi tỉ số phải khớp envelope. KHÔNG bịa.
2. KHÔNG gọi tool.
3. Đầu ra là MỘT JSON envelope duy nhất, không preamble, không Markdown fences.
4. Word count: 200-280 từ.
5. KHÔNG bullet, KHÔNG JSON, KHÔNG emoji trong articleMarkdown.

Schema:
{"articleMarkdown":"...","sourceMode":"api-only","evidenceIdsUsed":["facts"]}
`;

const FOOTBALL_PERSONA = `## Vai trò

Bạn là phóng viên thể thao kỳ cựu Việt Nam.

## Quy tắc cứng

1. API là nguồn chính. Mọi phút ghi bàn phải khớp envelope. KHÔNG bịa.
2. KHÔNG gọi tool.
3. Đầu ra là MỘT JSON envelope duy nhất.
4. KHÔNG ghi tỉ số ở đoạn mở đầu.
5. 250-400 từ.

Schema:
{"articleMarkdown":"...","sourceMode":"api-only","evidenceIdsUsed":["facts"]}
`;

async function runOne(sport: string, match: Match, llmCfg: LLMConfig): Promise<RunResult> {
  const pipelineStart = Date.now();
  let enrichedMatch: Match = match;
  if (match.sport === "tennis") {
    enrichedMatch = await enrichTennis(match as TennisMatch);
  }

  let sources: Awaited<ReturnType<typeof fetchMatchSources>>["sources"] = [];
  let firecrawlMs = 0;
  if (llmCfg.searchApiKey) {
    const fcStart = Date.now();
    const queries = match.sport === "football"
      ? [`${(match as FootballMatch).home.name} vs ${(match as FootballMatch).away.name} match report`]
      : [`${(match as TennisMatch).player1.fullName} ${(match as TennisMatch).player2.fullName} match report`];
    try {
      const r = await fetchMatchSources({ apiKey: llmCfg.searchApiKey, queries });
      sources = r.sources;
      firecrawlMs = Date.now() - fcStart;
    } catch (e) {
      firecrawlMs = Date.now() - fcStart;
      // eslint-disable-next-line no-console
      console.log(`    [firecrawl] ${match.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const evidence = buildMatchEvidence(enrichedMatch, sources);
  const persona = sport === "tennis" ? TENNIS_PERSONA : FOOTBALL_PERSONA;
  const fullPrompt = `${persona}\n${buildPromptContextWithSources(enrichedMatch, sources)}\n`;
  const cfgWithCap = { ...llmCfg, maxTokens: Math.min(llmCfg.maxTokens ?? 524_288, 524_288) };

  const fcStart = Date.now();
  let firstResult: Awaited<ReturnType<typeof callLLM>> | null = null;
  try {
    firstResult = await callLLM({
      prompt: fullPrompt,
      config: cfgWithCap,
      disableTools: true,
    });
  } catch (e) {
    const msg = e instanceof LLMError ? e.message : e instanceof Error ? e.message : String(e);
    return {
      sport,
      matchId: match.id,
      side1: match.sport === "tennis" ? (match as TennisMatch).player1.fullName : (match as FootballMatch).home.name,
      side2: match.sport === "tennis" ? (match as TennisMatch).player2.fullName : (match as FootballMatch).away.name,
      score: match.sport === "tennis"
        ? (match as TennisMatch).sets?.map((s) => `${s.player1}-${s.player2}`).join(", ") ?? "?"
        : (match as FootballMatch).finalScore ? `${(match as FootballMatch).finalScore?.side1}-${(match as FootballMatch).finalScore?.side2}` : "?",
      pipelineMs: Date.now() - pipelineStart,
      firecrawlMs,
      firecrawlSources: sources.length,
      firstCallMs: Date.now() - fcStart,
      firstCallFinish: "error",
      firstCallTurns: 0,
      validationIssues: [],
      blockingCount: 0,
      repairAttempted: false,
      status: "needs-review",
      error: `first-call failed: ${msg}`,
      articleChars: 0,
      evidenceSources: evidence.sources.length,
    };
  }
  const firstCallMs = Date.now() - fcStart;

  let envelope = parseEnvelope(firstResult.content);
  let validation = envelope ? validateEnvelope(envelope, evidence, { finishReason: firstResult.finishReason }) : null;
  let repairAttempted = false;
  let repairSucceeded: boolean | undefined;

  if (validation && !validation.ok) {
    repairAttempted = true;
    try {
      const issueCodes = validation.issues.filter((i) => i.blocking).map((i) => `- [${i.code}] ${i.message}`).join("\n");
      const repairPrompt = `${fullPrompt}\n\n## Repair\n\nResponse trước bị reject:\n${issueCodes}\n\nHãy viết LẠI MỘT JSON envelope.\n`;
      const repairResult = await callLLM({
        prompt: repairPrompt,
        config: cfgWithCap,
        disableTools: true,
      });
      const repaired = parseEnvelope(repairResult.content);
      if (repaired) {
        const revalidated = validateEnvelope(repaired, evidence, { finishReason: repairResult.finishReason });
        if (revalidated.ok) {
          envelope = repaired;
          validation = revalidated;
          repairSucceeded = true;
          firstResult = repairResult;
        } else {
          validation = revalidated;
        }
      }
    } catch {
      // keep first
    }
  }

  const status = validation?.ok ? "ready" : "needs-review";
  return {
    sport,
    matchId: match.id,
    side1: match.sport === "tennis" ? (match as TennisMatch).player1.fullName : (match as FootballMatch).home.name,
    side2: match.sport === "tennis" ? (match as TennisMatch).player2.fullName : (match as FootballMatch).away.name,
    score: match.sport === "tennis"
      ? (match as TennisMatch).sets?.map((s) => `${s.player1}-${s.player2}`).join(", ") ?? "?"
      : (match as FootballMatch).finalScore ? `${(match as FootballMatch).finalScore?.side1}-${(match as FootballMatch).finalScore?.side2}` : "?",
    pipelineMs: Date.now() - pipelineStart,
    firecrawlMs,
    firecrawlSources: sources.length,
    firstCallMs,
    firstCallFinish: firstResult.finishReason,
    firstCallTurns: firstResult.observability?.turns ?? 0,
    validationIssues: validation?.issues ?? [],
    blockingCount: validation?.blockingCount ?? 0,
    repairAttempted,
    repairSucceeded,
    status,
    error: envelope ? undefined : "no envelope parsed",
    articleChars: envelope?.articleMarkdown.length ?? 0,
    evidenceSources: evidence.sources.length,
  };
}

async function main() {
  const allResults: RunResult[] = [];

  for (const sport of ["tennis", "football"]) {
    console.log(`\n=== ${SPORT_LABEL[sport].toUpperCase()} ===`);
    const completed = await fetchCompletedMatches(sport, 14);
    // Loosely eligible: completed + has some score info already, OR
    // tennis which we'll enrich with details + PBP.
    const eligible = completed.filter((m) => {
      if (m.sport === "football") return (m as FootballMatch).finalScore !== undefined;
      return true;
    });
    const shuffled = [...eligible].sort(() => Math.random() - 0.5);
    const picks = shuffled.slice(0, MATCHES_PER_SPORT);
    console.log(`  ${picks.length} matches picked (out of ${eligible.length} eligible)`);

    for (const m of picks) {
      const id = `${m.sport === "tennis" ? (m as TennisMatch).player1.fullName : (m as FootballMatch).home.name} vs ${m.sport === "tennis" ? (m as TennisMatch).player2.fullName : (m as FootballMatch).away.name}`;
      console.log(`\n  → ${m.id}  ${id}`);
      try {
        const r = await runOne(sport, m, llmConfig);
        allResults.push(r);
        console.log(`     status=${r.status} blocking=${r.blockingCount} article=${r.articleChars}c fc=${r.firecrawlSources} firstCall=${(r.firstCallMs/1000).toFixed(1)}s finish=${r.firstCallFinish}${r.error ? ` err=${r.error}` : ""}`);
        if (r.validationIssues.length > 0) {
          for (const i of r.validationIssues.slice(0, 3)) {
            console.log(`       - [${i.blocking ? "B" : "w"}] ${i.code}: ${i.message}`);
          }
        }
      } catch (e) {
        console.log(`     CRASH: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  console.log(`\n\n=== SUMMARY (${allResults.length} matches) ===`);
  const byStatus = {
    ready: allResults.filter((r) => r.status === "ready"),
    needsReview: allResults.filter((r) => r.status === "needs-review"),
    errored: allResults.filter((r) => r.error),
  };
  console.log(`  ready:         ${byStatus.ready.length}`);
  console.log(`  needs-review:  ${byStatus.needsReview.length}`);
  console.log(`  errored:       ${byStatus.errored.length}`);
  console.log(`\n  By sport:`);
  for (const sport of ["tennis", "football"]) {
    const subset = allResults.filter((r) => r.sport === sport);
    console.log(`    ${SPORT_LABEL[sport]}: ${subset.length} matches, ${subset.filter((r) => r.status === "ready").length} ready, ${subset.filter((r) => r.status === "needs-review").length} needs-review, ${subset.filter((r) => r.error).length} errored`);
  }
  console.log(`\n  Per-match detail:`);
  for (const r of allResults) {
    console.log(`    [${r.sport.padEnd(8)}] ${r.matchId}  ${r.side1} vs ${r.side2}  (${r.score})`);
    console.log(`              ${r.status.padEnd(13)} fc=${r.firecrawlSources} first=${(r.firstCallMs/1000).toFixed(1)}s article=${r.articleChars}c blocking=${r.blockingCount} repair=${r.repairAttempted ? (r.repairSucceeded ? "ok" : "fail") : "-"}`);
  }
  fs.writeFileSync("/tmp/live-batch-results.json", JSON.stringify(allResults, null, 2));
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
