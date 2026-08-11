// Live acceptance: take the actual LLM responses (captured by the
// acceptance script in /tmp/live-acceptance.mjs) and run them through
// the validator. This confirms the publication gate agrees with what
// the model produced.
//
// Run with: npx tsx scripts/test-live-acceptance.ts

import { validateEnvelope, parseEnvelope } from "../src/reports/validate";
import type { MatchEvidence, TennisMatchEvidence, FootballMatchEvidence } from "../src/reports/evidence";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`❌ ${name}`);
    console.log(`   ${e instanceof Error ? e.message : e}`);
  }
}

// ---- Captured live acceptance responses ----

const tennisResponse = `\`\`\`json
{
  "articleMarkdown": "## Jakub Mensik giành chiến thắng thuyết phục tại ATP Montreal\\n\\nHạt giống số 14 Jakub Mensik đã có màn ra quân ấn tượng tại vòng 32 ATP Montreal khi đánh bại tay vợt người Hà Lan Botic van de Zandschulp với tỷ số **6-4, 7-5** sau 1 giờ 35 phút thi đấu trên mặt sân cứng.\\n\\nTay vợt người Cộng hòa Séc, hiện xếp hạng 18 ATP, thể hiện sự vượt trội trên nhiều mặt trận. Mensik đã ghi tới **12 ace** so với chỉ 4 của đối thủ, đồng thời tỷ lệ giao bóng một thành công đạt **65%**. Anh cũng tận dụng tốt các cơ hội break point với **4/5 lần thành công**, giúp kiểm soát thế trận tốt hơn so với Van de Zandschulp (chỉ 2/6).\\n\\nDù tay vợt Hà Lan xếp hạng 64 ATP tạo ra sức ép nhất định, Mensik vẫn giành chiến thắng với **80 điểm thắng** so với 65 của đối thủ, qua đó đi tiếp vào vòng tiếp theo của giải đấu Masters 1000 tại Canada.",
  "sourceMode": "api-only",
  "evidenceIdsUsed": ["facts", "statistics"]
}
\`\`\``;

const tennisEvidence: TennisMatchEvidence = {
  sport: "tennis",
  evidenceIds: ["facts", "statistics"],
  facts: {
    tournamentName: "ATP Montreal",
    tournamentCategory: "ATP Masters 1000",
    round: "R32",
    startTime: "2026-08-10T18:00:00Z",
    status: "completed",
    surface: "hard",
    player1: { name: "J. Mensik", fullName: "Jakub Mensik", country: "CZE", ranking: 18, seed: 14 },
    player2: { name: "B. van de Zandschulp", fullName: "Botic van de Zandschulp", country: "NED", ranking: 64, seed: null },
    winnerSide: 1,
    finalScore: [{ player1: 6, player2: 4 }, { player1: 7, player2: 5 }],
    winnerScore: [{ winner: 6, loser: 4 }, { winner: 7, loser: 5 }],
    matchDurationMinutes: 95,
  },
  statistics: {
    aces: { player1: 12, player2: 4 },
    doubleFaults: { player1: 2, player2: 5 },
    firstServePct: { player1: 65, player2: 55 },
    successfulBreaks: { player1: 4, player2: 2 },
    breakPointOpportunities: { player1: 5, player2: 6 },
    totalPointsWon: { player1: 80, player2: 65 },
    matchDurationMinutes: 95,
  },
  tacticalTimeline: null,
  sources: [],
  limitations: [],
};

test("tennis: live response parses + validates", () => {
  const env = parseEnvelope(tennisResponse);
  if (!env) throw new Error("envelope did not parse");
  const r = validateEnvelope(env, tennisEvidence, { finishReason: "end_turn" });
  // Allow non-blocking warnings (e.g. word count) but no blocking.
  if (r.blockingCount > 0) {
    throw new Error(`blocking issues: ${r.issues.filter((i) => i.blocking).map((i) => i.code).join(",")}`);
  }
  console.log(`   article length: ${env.articleMarkdown.length} chars`);
  console.log(`   non-blocking issues: ${r.issues.length}`);
});

const footballResponse = `\`\`\`json
{
  "articleMarkdown": "# Arsenal hạ gục Manchester City 2-1 trên sân nhà ở ngày khai màn Premier League\\n\\n**Vòng 1 Premier League – Sân Emirates, ngày 10/8/2026**\\n\\nArsenal đã có màn chào sân Premier League mùa giải mới đầy ấn tượng khi đánh bại đương kim á quân Manchester City với tỷ số 2-1 trên sân nhà Emirates.\\n\\n## Diễn biến trận đấu\\n\\nPháo thủ nhập cuộc tự tin và sớm chiếm lợi thế ngay trong hiệp một. Phút 23, từ pha phối hợp ăn ý với đội trưởng Martin Odegaard, Bukayo Saka tung cú dứt điểm chính xác mở tỷ số cho Arsenal. Hiệp một khép lại với lợi thế 1-0 nghiêng về đội chủ nhà.\\n\\nBước sang hiệp hai, Manchester City dồn lên tấn công tìm bàn gỡ. Nỗ lực của đội khách được đền đáp ở phút 58 khi Erling Haaland ghi bàn thắng quân bình tỷ số 1-1.\\n\\nTuy nhiên, đoàn quân của HLV Mikel Arteta không chịu đứng im. Phút 78, Gabriel Martinelli tỏa sáng với pha lập công ấn định chiến thắng chung cuộc 2-1 cho Arsenal.\\n\\n## Số liệu thống kê\\n\\nDù kiểm soát bóng ít hơn đối thủ (Arsenal 48% – Man City 52%), Pháo thủ lại tỏ ra vượt trội trong các tình huống dứt điểm với 14 cú sút (6 trúng đích), trong khi Manchester City chỉ có 9 pha dứt điểm với 3 lần đưa bóng vào khung thành.\\n\\n## Kết bài\\n\\nChiến thắng ngay vòng đấu mở màn giúp Arsenal có khởi đầu thuận lợi tại Premier League mùa giải mới, đồng thời gửi một thông điệp rõ ràng đến các đối thủ cạnh tranh ngôi vô địch. Trong khi đó, Manchester City sẽ cần nhanh chóng rút kinh nghiệm để trở lại mạch chiến thắng ở những vòng đấu tiếp theo.",
  "sourceMode": "api-only",
  "evidenceIdsUsed": ["facts", "matchEvents"]
}
\`\`\``;

const footballEvidence: FootballMatchEvidence = {
  sport: "football",
  evidenceIds: ["facts", "matchEvents"],
  facts: {
    tournamentName: "Premier League",
    tournamentCategory: "Top Domestic League",
    round: "Matchday 1",
    startTime: "2026-08-10T19:00:00Z",
    status: "completed",
    home: { name: "Arsenal", shortName: "ARS", country: "England" },
    away: { name: "Manchester City", shortName: "MCI", country: "England" },
    winnerSide: 1,
    finalScore: { home: 2, away: 1 },
    halftimeScore: { home: 1, away: 0 },
    outcome: "normal",
  },
  statistics: {
    possession: { home: 48, away: 52 },
    shots: { home: 14, away: 9 },
    shotsOnTarget: { home: 6, away: 3 },
    fouls: null,
    corners: null,
    yellowCards: null,
    redCards: null,
    offsides: null,
  },
  matchEvents: {
    goals: [
      { side: "home", minute: 23, scorer: "Saka", assist: "Odegaard" },
      { side: "away", minute: 58, scorer: "Haaland" },
      { side: "home", minute: 78, scorer: "Martinelli" },
    ],
    cards: [],
    subs: [],
  },
  sources: [],
  limitations: [],
};

test("football: live response parses + validates", () => {
  const env = parseEnvelope(footballResponse);
  if (!env) throw new Error("envelope did not parse");
  const r = validateEnvelope(env, footballEvidence, { finishReason: "end_turn" });
  if (r.blockingCount > 0) {
    throw new Error(`blocking issues: ${r.issues.filter((i) => i.blocking).map((i) => i.code).join(",")}`);
  }
  console.log(`   article length: ${env.articleMarkdown.length} chars`);
  console.log(`   non-blocking issues: ${r.issues.length}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
