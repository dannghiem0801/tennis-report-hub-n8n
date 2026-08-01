// Compose the FULL prompt that would be sent to the LLM for the
// Alex de Minaur vs Cruz Hewitt match (Mubadala DC Open 2026).
// Run: node scripts/build-test-prompt.mjs > /tmp/test-prompt-de-minaur.md
//
// Reads the live prompt template from src/reports/templates.ts so the
// output is byte-identical to what the app would send.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_FILE = path.resolve(__dirname, "../src/reports/templates.ts");

// ---- Match data (verified across 5+ independent sources) ----
const APP_TZ = "Asia/Ho_Chi_Minh";
const SURFACE_LABELS = { hard: "cứng", clay: "đất nện", grass: "cỏ" };

const match = {
  startTime: "2026-07-31T06:25:00+07:00", // 30/07 19:25 Washington EDT
  tournamentName: "Mubadala Citi DC Open",
  round: "Vòng 2",
  court: "William H.G. FitzGerald Tennis Center",
  surface: "hard",
  status: "completed",
  player1: { fullName: "Alex de Minaur", country: "AUS", ranking: 8, seed: 1 },
  player2: { fullName: "Cruz Hewitt",   country: "AUS", ranking: 612 },
  sets: [
    { player1: 6, player2: 2 },
    { player1: 6, player2: 3 },
  ],
  stats: {
    aces: { player1: 0, player2: 0 },
    doubleFaults: { player1: 0, player2: 0 },
    firstServePct: { player1: 0, player2: 0 },
    breakPointsConverted: { player1: 5, player2: 0 },
    breakPointsFaced: { player1: 0, player2: 5 },
    totalPointsWon: { player1: 0, player2: 0 },
    matchDurationMinutes: 61,
  },
};

// ---- helpers (mirror src/reports/templates.ts) ----
function getWinner() {
  let p1 = 0, p2 = 0;
  for (const s of match.sets) {
    if (s.player1 > s.player2) p1++;
    else if (s.player2 > s.player1) p2++;
  }
  if (p1 > p2) return 1;
  if (p2 > p1) return 2;
  return null;
}
function formatDateVi(d) {
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: APP_TZ });
}
function formatTime(d) {
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: APP_TZ, hour12: false });
}
function formatSetScores(sets) {
  return sets.map((s) => `${s.player1}-${s.player2}`).join(", ");
}

function buildPromptContext() {
  const start = new Date(match.startTime);
  const winner = getWinner();
  const winnerName = winner === 1 ? match.player1.fullName : winner === 2 ? match.player2.fullName : "—";
  const surface = SURFACE_LABELS[match.surface] || match.surface;
  const lines = [];
  lines.push(`- Ngày giờ: ${formatDateVi(start)}, ${formatTime(start)}`);
  lines.push(`- Giải đấu: ${match.tournamentName}`);
  lines.push(`- Vòng đấu: ${match.round}`);
  lines.push(`- Địa điểm: ${match.court}`);
  lines.push(`- Mặt sân: ${surface}`);
  lines.push(`- Tay vợt 1: ${match.player1.fullName} (${match.player1.country}, hạng ${match.player1.ranking}, hạt giống ${match.player1.seed})`);
  lines.push(`- Tay vợt 2: ${match.player2.fullName} (${match.player2.country}, hạng ${match.player2.ranking})`);
  lines.push(`- Trạng thái: Đã kết thúc`);
  lines.push(`- Tỷ số các set: ${formatSetScores(match.sets)}`);
  lines.push(`- Người thắng: ${winnerName}`);
  const a = match.stats.aces, bp = match.stats.breakPointsConverted, fs = match.stats.firstServePct;
  lines.push(`- Thống kê: ace ${a.player1}-${a.player2}, % giao bóng 1 ${fs.player1}-${fs.player2}, break ${bp.player1}-${bp.player2}, tổng điểm thắng ${match.stats.totalPointsWon.player1}-${match.stats.totalPointsWon.player2}, thời lượng ${match.stats.matchDurationMinutes} phút`);
  return lines.join("\n");
}

// ---- extract the live template content from src/reports/templates.ts ----
const src = fs.readFileSync(TEMPLATE_FILE, "utf-8");
const m = src.match(/const TENNIS_JOURNALIST_PROMPT\s*=\s*`([\s\S]*?)`;\s*\n/);
if (!m) {
  console.error("Could not find TENNIS_JOURNALIST_PROMPT in templates.ts");
  process.exit(1);
}
// Unescape backticks (\` → `) — TS template literal escape for inner backticks
const promptContent = m[1].replace(/\\`/g, "`");

// ---- compose the full prompt the same way applyTemplate does ----
const context = buildPromptContext();
const fullPrompt = `${promptContent.trim()}\n\n## Dữ liệu trận đấu (do hệ thống cung cấp)\n\nDưới đây là dữ liệu thô về trận đấu. Hãy viết bản tin dựa trên các trường sau:\n\n${context}\n`;

const separator = "═".repeat(80);
console.log(separator);
console.log("FULL PROMPT SENT TO LLM (de Minaur vs Hewitt, Mubadala DC Open 2026)");
console.log(`${fullPrompt.length.toLocaleString()} chars total`);
console.log(separator);
console.log(fullPrompt);
console.log(separator);
console.log("END OF PROMPT");
console.log(separator);
console.log("");
console.log("=== EXPECTED TOOL FLOW ===");
console.log("Turn 1 — POST /v1/messages");
console.log("  Body: { model, system: <prompt up to '## Dữ liệu trận đấu'>, messages: [user: <context>], thinking: {type:adaptive}, tools: [web_search] }");
console.log("  Model returns: { stop_reason: 'tool_use', content: [thinking, tool_use{name:web_search, input:{query:...}}] }");
console.log("");
console.log("Turn 2 — POST /v1/messages");
console.log("  Body appends: assistant: data.content + user: [tool_result{tool_use_id, content: <STUB>}]");
console.log("  Model returns: { stop_reason: 'end_turn', content: [text: <full Vietnamese article>] }");
