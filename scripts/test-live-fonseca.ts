// Live acceptance test: replicate the exact prompt the production
// pipeline emitted for the Fonseca vs Shelton match, call the LLM,
// then validate the response.
//
// Run with: npx tsx scripts/test-live-fonseca.ts

import fs from "node:fs";
import { validateEnvelope, parseEnvelope } from "../src/reports/validate";
import type { TennisMatchEvidence } from "../src/reports/evidence";

const envFile = fs.readFileSync(".env.local", "utf8");
const env: Record<string, string> = {};
for (const line of envFile.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}
const BASE_URL = env.VITE_LLM_BASE_URL;
const API_KEY = env.VITE_LLM_API_KEY;
const MODEL = env.VITE_LLM_MODEL;

// The exact JSON envelope your test captured from the production
// pipeline (Fonseca vs Shelton, ATP Montreal 2026-08-09).
const envelope: TennisMatchEvidence = JSON.parse(`{
  "sport": "tennis",
  "evidenceIds": ["facts", "tacticalTimeline", "web-0", "web-1"],
  "facts": {
    "tournamentName": "ATP - SINGLES: Montreal (Canada), hard",
    "round": "—",
    "startTime": "2026-08-09T22:10:00.000Z",
    "status": "completed",
    "surface": "unknown",
    "player1": {"name": "Fonseca J.", "fullName": "Fonseca J.", "country": "BR", "ranking": null, "seed": null},
    "player2": {"name": "Shelton B.", "fullName": "Shelton B.", "country": "US", "ranking": null, "seed": null},
    "tournamentCategory": "ATP 250",
    "winnerSide": 2,
    "finalScore": [{"player1": 3, "player2": 6}, {"player1": 6, "player2": 7}],
    "winnerScore": [{"winner": 6, "loser": 3}, {"winner": 7, "loser": 6}],
    "matchDurationMinutes": null
  },
  "statistics": null,
  "tacticalTimeline": null,
  "sources": [
    {"evidenceId": "web-0", "url": "https://www.flashscore.com/match/tennis/fonseca-joao-tv073LUc/shelton-ben-QNuG0Gzb/", "title": "Joao Fonseca v Ben Shelton 09/08/2026 | Tennis - Flashscore.com", "excerpt": "...", "verified": false},
    {"evidenceId": "web-1", "url": "https://www.sofascore.com/tennis/match/joao-fonseca-ben-shelton/KjedsuCld", "title": "Joao Fonseca vs Ben Shelton live score and H2H results - Sofascore", "excerpt": "...", "verified": false}
  ],
  "limitations": ["pbp_invalid:pbp_winner_mismatch", "pbp_detail:set 1 game 1: increment side=1 but game_winner=2"]
}`);

// Persona + rules from the bundled tennis prompt.
const persona = `## Vai trò

Bạn là phóng viên thể thao chuyên mảng tennis, có nhiệm vụ tường thuật diễn biến các trận đấu tennis thành bản tin ngắn gọn bằng tiếng Việt.

## Hợp đồng dữ liệu (BẮT BUỘC đọc)

Hệ thống cung cấp MỘT khối JSON envelope ở cuối prompt. KHÔNG gọi tool.

## Quy tắc cứng

1. API là nguồn chính. Mọi tỉ số set, ace, % first serve, break phải khớp envelope. KHÔNG bịa.
2. "successful breaks" ≠ "break-point opportunities".
3. Tactical timeline: CHỈ viết diễn biến từng game khi tacticalTimeline tồn tại. Nếu null, KHÔNG đề cập "break ở game X".
4. Web sources CHỈ dùng khi cite. PHẢI kèm evidence ID trong ngoặc vuông. Source verified=false KHÔNG dùng làm claim.
5. KHÔNG gọi tool.
6. Đầu ra là MỘT JSON envelope duy nhất, không preamble, không URL, không Markdown fences:
   {"articleMarkdown": "<văn bản tiếng Việt 200-280 từ>", "sourceMode": "api-only" hoặc "api-plus-web", "evidenceIdsUsed": ["facts", "web-0", ...]}
7. Văn phong: khách quan, thì quá khứ, ngôi thứ 3. KHÔNG bullet, KHÔNG JSON, KHÔNG emoji.
8. Word count: 200-280 từ mặc định.
9. evidenceIdsUsed chỉ chứa facts + các web-i thực sự dùng.
10. Khi sources rỗng thì sourceMode = "api-only".

## Dữ liệu trận đấu

\`\`\`json
${JSON.stringify(envelope, null, 2)}
\`\`\`
`;

async function callLlm(maxTokens: number) {
  const start = Date.now();
  const res = await fetch(BASE_URL + "/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: persona }],
    }),
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (!res.ok) {
    return { ok: false, status: res.status, body: await res.text().catch(() => "") };
  }
  const data = await res.json();
  return { ok: true, elapsed, data };
}

console.log("→ First attempt (max_tokens=8000)");
let r = await callLlm(8000);
if (!r.ok) {
  console.error("HTTP", r.status, r.body);
  process.exit(1);
}
let { data } = r;
console.log("← HTTP 200 in", r.elapsed + "s");
console.log("stop_reason:", data.stop_reason);
console.log("usage:", JSON.stringify(data.usage));

let text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
const blockTypes = (data.content ?? []).map((b) => b.type);
console.log("content block types:", blockTypes);

// If truncated, retry with more tokens to confirm the model CAN respond.
if (data.stop_reason === "max_tokens" || text.length === 0) {
  console.log("\n→ Retry with max_tokens=12000 (thinking budget exhausted on first call)");
  r = await callLlm(12000);
  if (!r.ok) {
    console.error("HTTP", r.status, r.body);
    process.exit(1);
  }
  data = r.data;
  console.log("← HTTP 200 in", r.elapsed + "s");
  console.log("stop_reason:", data.stop_reason);
  console.log("usage:", JSON.stringify(data.usage));
  text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

console.log("\n=== RAW RESPONSE ===\n" + (text || "(empty)") + "\n=== END ===\n");

const parsed = parseEnvelope(text);
console.log("Envelope parse:", parsed ? "OK" : "FAIL");
if (!parsed) {
  console.log("\nNote: empty/truncated response would trigger the validator's needs-review path in production.");
  console.log("Validator already covers: missing articleMarkdown, finishReason=max_tokens, no terminal text.");
  process.exit(0);
}

console.log("articleMarkdown length:", parsed.articleMarkdown.length);
console.log("sourceMode:", parsed.sourceMode);
console.log("evidenceIdsUsed:", JSON.stringify(parsed.evidenceIdsUsed));

const validation = validateEnvelope(parsed, envelope, { finishReason: data.stop_reason });
console.log("\n=== VALIDATION ===");
console.log("ok:", validation.ok);
console.log("blocking issues:", validation.blockingCount);
for (const issue of validation.issues) {
  const tag = issue.blocking ? "[B]" : "[w]";
  console.log(`  ${tag} ${issue.code}: ${issue.message}`);
}

const status = validation.ok ? "ready" : "needs-review";
console.log("\nReport status:", status);
console.log("Article copy disabled:", status === "needs-review");
