// Re-runs the live batch but writes progress incrementally to
// /tmp/final-reports.json after every successful match so we never
// lose completed work.

import fs from "node:fs";
const envFile = fs.readFileSync(".env.local", "utf8");
const env: Record<string, string> = {};
for (const line of envFile.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}
for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;

const { getMatchesByDate } = await import("../src/api/flashscore");
const { mapMatchesBatch } = await import("../src/api/flashscore-mapper");
const { buildMatchEvidence } = await import("../src/reports/evidence");
const { validateEnvelope, parseEnvelope } = await import("../src/reports/validate");
const { callLLM, LLMError } = await import("../src/api/llm");
const { buildPromptContextWithSources } = await import("../src/reports/templates");
const { fetchMatchSources } = await import("../src/api/firecrawl");
import type { Match, TennisMatch, FootballMatch, LLMConfig } from "../src/types";

const TENNIS_PERSONA = `## Vai trò\n\nBạn là phóng viên thể thao chuyên mảng tennis.\n\n## Quy tắc cứng\n\n1. API là nguồn chính. Mọi tỉ số phải khớp envelope. KHÔNG bịa.\n2. KHÔNG gọi tool.\n3. Đầu ra là MỘT JSON envelope duy nhất, không preamble, không Markdown fences.\n4. Word count: 200-280 từ.\n5. KHÔNG bullet, KHÔNG JSON, KHÔNG emoji trong articleMarkdown.\n\nSchema: {"articleMarkdown":"...","sourceMode":"api-only","evidenceIdsUsed":["facts"]}\n`;
const FOOTBALL_PERSONA = `## Vai trò\n\nBạn là phóng viên thể thao kỳ cựu Việt Nam.\n\n## Quy tắc cứng\n\n1. API là nguồn chính. Mọi phút ghi bàn phải khớp envelope. KHÔNG bịa.\n2. KHÔNG gọi tool.\n3. Đầu ra là MỘT JSON envelope duy nhất.\n4. KHÔNG ghi tỉ số ở đoạn mở đầu.\n5. 250-400 từ.\n\nSchema: {"articleMarkdown":"...","sourceMode":"api-only","evidenceIdsUsed":["facts"]}\n`;

interface FinalReport {
  sport: string;
  matchId: string;
  side1: string;
  side2: string;
  score: string;
  status: string;
  article: string;
  sourceMode: string;
  evidenceIdsUsed: string[];
  firecrawlSources: number;
  firecrawlSourceDetails: Array<{ evidenceId: string; url: string; title: string; verified: boolean }>;
  firstCallMs: number;
  firstCallFinish: string;
  blockingIssues: string[];
}

const outFile = "/tmp/final-reports.json";
fs.writeFileSync(outFile, "[]");

async function fetchCompleted(sport: string, days: number): Promise<Match[]> {
  const sportId = sport === "tennis" ? 2 : 1;
  const today = new Date();
  const out: Match[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    try {
      const payload = await getMatchesByDate({
        apiKey: env.VITE_RAPID_API_KEY, sportId, date: dateKey, timezone: "Asia/Ho_Chi_Minh",
      });
      const { matches } = mapMatchesBatch({ payload, dateKey, sport: sport as "tennis" | "football" });
      out.push(...matches.filter((m) => m.status === "completed"));
    } catch {}
  }
  return out;
}

const llmConfig: LLMConfig = {
  enabled: true,
  provider: "anthropic",
  baseUrl: "http://localhost:5173/llm-proxy",
  apiKey: env.VITE_LLM_API_KEY ?? "",
  model: env.VITE_LLM_MODEL ?? "",
  maxTokens: Math.min(env.VITE_LLM_MAX_TOKENS ? parseInt(env.VITE_LLM_MAX_TOKENS, 10) : 524288, 524288),
  temperature: env.VITE_LLM_TEMPERATURE ? parseFloat(env.VITE_LLM_TEMPERATURE) : undefined,
  enableThinking: (env.VITE_LLM_ENABLE_THINKING ?? "true") === "true",
  enableWebSearch: (env.VITE_LLM_ENABLE_WEB_SEARCH ?? "true") === "true",
  searchProvider: "firecrawl",
  searchApiKey: env.VITE_LLM_SEARCH_API_KEY ?? "",
};

async function runOne(sport: string, match: Match): Promise<FinalReport | null> {
  const queries = match.sport === "football"
    ? [`${(match as FootballMatch).home.name} vs ${(match as FootballMatch).away.name} match report`]
    : [`${(match as TennisMatch).player1.fullName} ${(match as TennisMatch).player2.fullName} match report`];
  let sources: Awaited<ReturnType<typeof fetchMatchSources>>["sources"] = [];
  try {
    const r = await fetchMatchSources({ apiKey: llmConfig.searchApiKey ?? "", queries });
    sources = r.sources;
  } catch {}
  const evidence = buildMatchEvidence(match, sources);
  const persona = sport === "tennis" ? TENNIS_PERSONA : FOOTBALL_PERSONA;
  const prompt = `${persona}\n${buildPromptContextWithSources(match, sources)}\n`;
  const fcStart = Date.now();
  let firstResult;
  try {
    firstResult = await callLLM({ prompt, config: llmConfig, disableTools: true });
  } catch {
    return null;
  }
  const firstCallMs = Date.now() - fcStart;
  const envelope = parseEnvelope(firstResult.content);
  if (!envelope) return null;
  const validation = validateEnvelope(envelope, evidence, { finishReason: firstResult.finishReason });
  return {
    sport,
    matchId: match.id,
    side1: match.sport === "tennis" ? (match as TennisMatch).player1.fullName : (match as FootballMatch).home.name,
    side2: match.sport === "tennis" ? (match as TennisMatch).player2.fullName : (match as FootballMatch).away.name,
    score: match.sport === "tennis"
      ? (match as TennisMatch).sets?.map((s) => `${s.player1}-${s.player2}`).join(", ") ?? "?"
      : (match as FootballMatch).finalScore ? `${(match as FootballMatch).finalScore?.side1}-${(match as FootballMatch).finalScore?.side2}` : "?",
    status: validation.ok ? "ready" : "needs-review",
    article: envelope.articleMarkdown,
    sourceMode: envelope.sourceMode,
    evidenceIdsUsed: envelope.evidenceIdsUsed,
    firecrawlSources: sources.length,
    firecrawlSourceDetails: evidence.sources.map((s) => ({
      evidenceId: s.evidenceId, url: s.url, title: s.title, verified: s.verified,
    })),
    firstCallMs,
    firstCallFinish: firstResult.finishReason,
    blockingIssues: validation.issues.filter((i) => i.blocking).map((i) => `[${i.code}] ${i.message}`),
  };
}

function appendReport(r: FinalReport) {
  const cur = JSON.parse(fs.readFileSync(outFile, "utf8")) as FinalReport[];
  cur.push(r);
  fs.writeFileSync(outFile, JSON.stringify(cur, null, 2));
}

const all = [];
for (const sport of ["tennis", "football"] as const) {
  const completed = await fetchCompleted(sport, 14);
  const eligible = completed.filter((m) => m.sport === "football" ? !!(m as FootballMatch).finalScore : true);
  const picks = eligible.slice(0, 5);
  console.error(`[${sport}] ${picks.length} picks`);
  for (const m of picks) {
    try {
      const r = await runOne(sport, m);
      if (r) {
        appendReport(r);
        all.push(r);
        console.error(`[${sport}] ${r.matchId} ${r.side1} vs ${r.side2} -> ${r.status}`);
      }
    } catch (e) {
      console.error(`[${sport}] ${m.id} crashed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
console.error(`Done. ${all.length} reports in ${outFile}`);
