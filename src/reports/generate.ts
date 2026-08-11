import type {
  FootballMatch,
  Match,
  LLMConfig,
  Report,
  ReportQuality,
  ReportTemplate,
  Settings,
  TennisMatch,
} from "@/types";
import { buildPromptContextWithSources, getDefaultTemplate } from "./templates";
import { uid } from "@/lib/utils";
import { callLLM, isLLMConfigured, LLMError } from "@/api/llm";
import { buildMatchQueries, fetchMatchSources, type FirecrawlSource } from "@/api/firecrawl";
import { buildMatchEvidence, type MatchEvidence, type McpEvidence } from "./evidence";
import {
  applyMcpTennisMatchDetails,
  applyMcpTennisPointByPoint,
  compactMcpEvidenceForReport,
  fetchMcpEvidence,
  selectMcpRequests,
} from "./mcp-enrichment";
import {
  buildRepairPrompt,
  parseEnvelope,
  validateEnvelope,
  type ValidationIssue,
  type ValidationResult,
} from "./validate";

/** Per-call report budget. A published article is 200-400 words, so a
 *  bounded budget prevents a reasoning model from consuming minutes of
 *  upstream time on an unusably long draft or hidden reasoning trace. */
const LLM_MAX_TOKENS = 8_192;
/** Validator + prompt bundle version. Bump whenever the
 *  validator/prompt schema changes in an incompatible way. */
export const VALIDATOR_VERSION = "publication-safe-v1";

/* ================================================================== */
/*  Sport dispatchers                                                  */
/*                                                                    */
/*  All narrative helpers below are sport-specific. The dispatchers  */
/*  here route to the right variant based on `match.sport`. This is   */
/*  the ADR 0002 multi-sport boundary: tennis and football have       */
/*  completely different narrative shape (sets vs goals, players vs  */
/*  teams, ranking vs shortName) and shouldn't share code.           */
/* ================================================================== */

const SURFACE_LABELS: Record<string, string> = {
  hard: "cứng",
  clay: "đất nện",
  grass: "cỏ",
};

const FOOTBALL_OUTCOME_LABELS: Record<string, string> = {
  normal: "",
  aet: "(sau hiệp phụ)",
  pen: "(trên chấm luân lưu)",
  retired: "",
  walkover: "(đối thủ bỏ cuộc)",
  cancelled: "(trận bị huỷ)",
  abandoned: "(trận bị bỏ dở)",
};

/* ------------------------------------------------------------------ */
/* Tennis helpers — unchanged from the original code path             */
/* ------------------------------------------------------------------ */

function formatTennisSetScore(set: NonNullable<TennisMatch["sets"]>[number]): string {
  const base = `${set.player1}-${set.player2}`;
  return set.tiebreak
    ? `${base} (${set.tiebreak.player1}-${set.tiebreak.player2})`
    : base;
}

function formatTennisFullScore(sets: TennisMatch["sets"]): string {
  if (!sets) return "";
  return sets.map(formatTennisSetScore).join(", ");
}

function getTennisWinner(match: TennisMatch): 1 | 2 | null {
  if (match.status !== "completed" || !match.sets || match.sets.length === 0) return null;
  let p1 = 0;
  let p2 = 0;
  for (const set of match.sets) {
    if (set.player1 > set.player2) p1++;
    else if (set.player2 > set.player1) p2++;
  }
  if (p1 > p2) return 1;
  if (p2 > p1) return 2;
  return null;
}

function buildSetNarrative(match: TennisMatch, winner: 1 | 2 | null): string {
  const sets = match.sets || [];
  if (sets.length === 0) return "Trận đấu chưa có dữ liệu set.";
  const winnerName = winner === 1 ? match.player1.fullName : match.player2.fullName;
  const loserName = winner === 1 ? match.player2.fullName : match.player1.fullName;
  const lines: string[] = [];
  sets.forEach((set, i) => {
    const setWinner = set.player1 > set.player2 ? match.player1.fullName : match.player2.fullName;
    const isDecider = sets.length >= 3 && i === sets.length - 1;
    const score = formatTennisSetScore(set);

    if (i === 0) {
      lines.push(isDecider ? `Set quyết định mở màn với những pha bóng giằng co, ${setWinner} sớm chiếm ưu thế và giành set ${score}.` : `${setWinner} chủ động dẫn điểm từ đầu và khép lại set ${score}.`);
    } else if (i === sets.length - 1 && isDecider) {
      lines.push(`Bước ngoặt đến ở set cuối: ${winnerName} bẻ game quan trọng, tạo khoảng cách an toàn và bảo toàn tỉ số ${score}, chính thức khép lại trận đấu.`);
    } else {
      const comeback = (winner === 1 && set.player1 < set.player2) || (winner === 2 && set.player2 > set.player1);
      lines.push(
        comeback
          ? `${setWinner} đáp trả mạnh mẽ ở set ${i + 1} với tỉ số ${score}, cân bằng thế trận sau khi ${loserName} thắng set trước.`
          : `${setWinner} tiếp tục duy trì sức ép và thắng set ${i + 1} với tỉ số ${score}.`
      );
    }
  });
  return lines.join(" ");
}

function buildMomentumNote(match: TennisMatch, winner: 1 | 2 | null): string {
  if (!winner) return "";
  const winnerName = winner === 1 ? match.player1.fullName : match.player2.fullName;
  const loserName = winner === 1 ? match.player2.fullName : match.player1.fullName;
  const sets = match.sets || [];
  let swings = 0;
  for (let i = 1; i < sets.length; i++) {
    if ((sets[i - 1].player1 > sets[i - 1].player2) !== (sets[i].player1 > sets[i].player2)) swings++;
  }
  if (swings >= 2) return `Trận đấu chứng kiến nhiều lần đổi thế, nhưng ${winnerName} cho thấy bản lĩnh vững vàng hơn ở những game then chốt, qua đó hạ gục ${loserName}.`;
  return `${winnerName} kiểm soát nhịp độ trận đấu tốt hơn, hạn chế tối đa những sai lầm không đáng có và tận dụng tốt cơ hội của mình.`;
}

function buildContextNote(match: TennisMatch, winner: 1 | 2 | null): string {
  if (!winner) return "";
  const winnerObj = winner === 1 ? match.player1 : match.player2;
  const loserObj = winner === 1 ? match.player2 : match.player1;
  const winnerRank = winnerObj.ranking;
  const loserRank = loserObj.ranking;
  if (!winnerRank || !loserRank) return `Chiến thắng này giúp ${winnerObj.fullName} tiếp tục duy trì phong độ ổn định trong mùa giải.`;
  if (winnerRank < loserRank) return `Với chiến thắng này, tay vợt hạng ${winnerRank} thế giới ${winnerObj.fullName} tiếp tục khẳng định vị trí trước đối thủ xếp hạng ${loserRank}.`;
  return `${winnerObj.fullName} (hạng ${winnerRank}) tạo bất ngờ khi hạ gục đối thủ xếp trên mình — ${loserObj.fullName} (hạng ${loserRank}) — qua đó gửi thông điệp mạnh mẽ tới phần còn lại của mùa giải.`;
}

function fillTennisTemplate(template: string, match: TennisMatch, winner: 1 | 2 | null): string {
  const w = winner ?? 1;
  const winnerObj = w === 1 ? match.player1 : match.player2;
  const loserObj = w === 1 ? match.player2 : match.player1;
  const score = formatTennisFullScore(match.sets);
  const aces = match.stats?.aces || { player1: 0, player2: 0 };
  const fsp = match.stats?.firstServePct || { player1: 60, player2: 55 };
  const bp = match.stats?.breakPointsConverted || { player1: 0, player2: 0 };
  const bpFaced = match.stats?.breakPointsFaced || { player1: 0, player2: 0 };
  const duration = match.stats?.matchDurationMinutes ?? 100;
  const acesWinner = w === 1 ? aces.player1 : aces.player2;
  const acesLoser = w === 1 ? aces.player2 : aces.player1;
  const acesRatio = acesLoser > 0 ? (acesWinner / acesLoser).toFixed(1) : "nhiều";
  const firstServePctWinner = w === 1 ? fsp.player1 : fsp.player2;
  const firstServePctLoser = w === 1 ? fsp.player2 : fsp.player1;
  const bpConvertedWinner = w === 1 ? bp.player1 : bp.player2;
  const bpFacedWinner = w === 1 ? bpFaced.player1 : bpFaced.player2;
  const seedText1 = match.player1.seed ? `, hạt giống số ${match.player1.seed}` : "";
  const seedText2 = match.player2.seed ? `, hạt giống số ${match.player2.seed}` : "";
  const replacements: Record<string, string> = {
    "{tournament}": match.tournamentName,
    "{round}": match.round,
    "{surface}": match.surface || "hard",
    "{surfaceLabel}": SURFACE_LABELS[match.surface || "hard"] || "cứng",
    "{player1}": match.player1.name,
    "{player1Full}": match.player1.fullName,
    "{flag1}": match.player1.countryFlag,
    "{rank1}": String(match.player1.ranking ?? "—"),
    "{seedText1}": seedText1,
    "{player2}": match.player2.name,
    "{player2Full}": match.player2.fullName,
    "{flag2}": match.player2.countryFlag,
    "{rank2}": String(match.player2.ranking ?? "—"),
    "{seedText2}": seedText2,
    "{winner}": winnerObj.name,
    "{winnerFull}": winnerObj.fullName,
    "{loser}": loserObj.name,
    "{loserFull}": loserObj.fullName,
    "{winnerRank}": String(winnerObj.ranking ?? "—"),
    "{loserRank}": String(loserObj.ranking ?? "—"),
    "{score}": score,
    "{setScores}": score,
    "{setNarrative}": buildSetNarrative(match, winner),
    "{pointByPoint}": formatTennisPointByPointForLLM(match, winner),
    "{momentumNote}": buildMomentumNote(match, winner),
    "{contextNote}": buildContextNote(match, winner),
    "{turningPoint}": "giữa set thứ 3",
    "{duration}": String(duration),
    "{acesWinner}": String(acesWinner),
    "{acesLoser}": String(acesLoser),
    "{acesRatio}": acesRatio,
    "{firstServePct}": String(firstServePctWinner),
    "{firstServePctLoser}": String(firstServePctLoser),
    "{bpConverted}": String(bpConvertedWinner),
    "{bpFaced}": String(bpFacedWinner),
  };
  let out = template;
  for (const [key, val] of Object.entries(replacements)) {
    out = out.split(key).join(val);
  }
  return out;
}

function formatTennisPointByPointForLLM(
  match: TennisMatch,
  winner: 1 | 2 | null,
): string {
  const pbp = match.pointByPoint;
  if (!pbp || pbp.sets.length === 0) return "";

  const p1Name = match.player1.fullName;
  const p2Name = match.player2.fullName;
  const lines: string[] = [];

  lines.push("### Diễn biến point-by-point (từ FlashScore API)");

  const totalBreaks = { 1: 0, 2: 0 };
  let totalDeuceGames = 0;
  let longestGamePoints = 0;

  for (const set of pbp.sets) {
    const p1SetGames = set.games[set.games.length - 1]?.homeGames ?? 0;
    const p2SetGames = set.games[set.games.length - 1]?.awayGames ?? 0;
    lines.push("");
    lines.push(
      `**${set.name}**: ${p1Name} ${p1SetGames} - ${p2Name} ${p2SetGames} ` +
        `(${p1SetGames > p2SetGames ? p1Name : p2Name} thắng set)`
    );
    lines.push("");

    for (let i = 0; i < set.games.length; i++) {
      const g = set.games[i];
      const gameNum = i + 1;
      const server = g.server === 1 ? p1Name : p2Name;
      const gameWin = g.gameWinner === 1 ? p1Name : p2Name;
      const isBreak = g.isBreak !== null;
      const pointCount = g.pointSequence.split(",").filter((p) => p.trim()).length;
      const hasDeuce = pointCount >= 6;

      if (isBreak) totalBreaks[g.isBreak as 1 | 2]++;
      if (hasDeuce) totalDeuceGames++;
      if (pointCount > longestGamePoints) longestGamePoints = pointCount;

      const isLastGameOfSet = i === set.games.length - 1;
      const isHighlighted = isBreak || hasDeuce || pointCount >= 10 || isLastGameOfSet;
      if (!isHighlighted) continue;

      const marker = isBreak ? " 🔴 BREAK" : hasDeuce ? " ⏱ Deuce" : pointCount >= 10 ? " ⏳ Long game" : " ✓ Set point";
      lines.push(
        `  Game ${gameNum}: ${server} serve → ${gameWin} thắng (${g.homeGames}-${g.awayGames})${marker}`
      );
      lines.push(`    Points: ${g.pointSequence}`);
    }
  }

  lines.push("");
  lines.push("**Tổng kết point-by-point:**");
  lines.push(
    `- Break points: ${p1Name} ${totalBreaks[1]} lần, ${p2Name} ${totalBreaks[2]} lần`
  );
  lines.push(`- Deuce games: ${totalDeuceGames}`);
  lines.push(`- Game dài nhất: ${longestGamePoints} điểm`);

  if (winner) {
    const winnerBreaks = totalBreaks[winner as 1 | 2];
    const loserBreaks = totalBreaks[winner === 1 ? 2 : 1];
    lines.push(
      winnerBreaks > loserBreaks
        ? `- ${winner === 1 ? p1Name : p2Name} thắng nhờ break serve nhiều hơn (${winnerBreaks} vs ${loserBreaks})`
        : ""
    );
  }

  return lines.join("\n");
}

function generateTennisTitle(match: TennisMatch, winner: 1 | 2 | null): string {
  if (!winner) return `${match.player1.name} vs ${match.player2.name}`;
  const winnerObj = winner === 1 ? match.player1 : match.player2;
  const loserObj = winner === 1 ? match.player2 : match.player1;
  const sets = match.sets || [];
  const winnerSetCount = sets.filter((s) => (winner === 1 ? s.player1 > s.player2 : s.player2 > s.player1)).length;
  const loserSetCount = sets.length - winnerSetCount;
  const wentTo3 = sets.length === 3;
  const isComeback = wentTo3 && sets[0][winner === 1 ? "player2" : "player1"] > sets[0][winner === 1 ? "player1" : "player2"];
  if (isComeback) return `${winnerObj.fullName} ngược dòng hạ ${loserObj.fullName} sau ${sets.length} set tại ${match.tournamentName.split("—")[1]?.trim() || match.tournamentName}`;
  if (wentTo3) return `${winnerObj.fullName} thắng kịch tính ${loserObj.fullName} ${winnerSetCount}-${loserSetCount} tại ${match.tournamentName.split("—")[1]?.trim() || match.tournamentName}`;
  return `${winnerObj.fullName} đánh bại ${loserObj.fullName} ${winnerSetCount}-${loserSetCount} ở ${match.round} ${match.tournamentName.split("—")[1]?.trim() || match.tournamentName}`;
}

/* ------------------------------------------------------------------ */
/* Football helpers — new for v1.5 (ADR 0002)                          */
/* ------------------------------------------------------------------ */

function formatFootballScore(match: FootballMatch): string {
  if (!match.finalScore) return "";
  return `${match.finalScore.side1}-${match.finalScore.side2}`;
}

function getFootballWinner(match: FootballMatch): 1 | 2 | null {
  if (match.status !== "completed" || !match.finalScore) return null;
  if (match.finalScore.side1 > match.finalScore.side2) return 1;
  if (match.finalScore.side2 > match.finalScore.side1) return 2;
  return null;
}

function buildGoalNarrative(match: FootballMatch, winner: 1 | 2 | null): string {
  const events = match.events;
  if (!events || events.goals.length === 0) {
    return "Trận đấu chưa có dữ liệu bàn thắng chi tiết.";
  }
  const homeName = match.home.name;
  const awayName = match.away.name;
  const winnerName = winner === 1 ? homeName : winner === 2 ? awayName : null;
  const loserName = winner === 1 ? awayName : winner === 2 ? homeName : null;

  const lines: string[] = [];
  events.goals.forEach((goal, i) => {
    const scoringSide = goal.side === "home" ? homeName : awayName;
    const minute = goal.stoppage ? `${goal.minute}+${goal.stoppage}` : `${goal.minute}`;
    const tag = goal.isPenalty ? " (phạt đền)" : goal.isOwnGoal ? " (phản lưới)" : "";
    const assistText = goal.assist ? ` (kiến tạo: ${goal.assist})` : "";
    if (i === 0) {
      lines.push(
        winner && scoringSide === winnerName
          ? `${scoringSide} mở tỉ số ở phút ${minute}${tag} qua pha lập công của ${goal.scorer}${assistText}, sớm chiếm ưu thế trong trận đấu.`
          : `${scoringSide} bất ngờ có bàn mở tỉ số ở phút ${minute}${tag} nhờ công ${goal.scorer}${assistText}, gây sức ép ngay từ đầu.`
      );
    } else {
      const prev = events.goals[i - 1];
      const isEqualizer = goal.side !== (prev as { side: "home" | "away" }).side;
      const isLeadChange = isEqualizer && match.finalScore;
      const goalSoFar = events.goals.slice(0, i + 1);
      const homeGoalsSoFar = goalSoFar.filter((g) => g.side === "home").length;
      const awayGoalsSoFar = goalSoFar.filter((g) => g.side === "away").length;
      const currentScore = `${homeGoalsSoFar}-${awayGoalsSoFar}`;
      if (isLeadChange) {
        lines.push(
          `Bước ngoặt đến ở phút ${minute}: ${scoringSide} gỡ hoà/ngược dòng thành ${currentScore} nhờ pha lập công của ${goal.scorer}${tag}, đảo chiều thế trận.`
        );
      } else if (isEqualizer) {
        lines.push(
          `${scoringSide} gỡ hoà ở phút ${minute}${tag} qua công ${goal.scorer}${assistText}, cân bằng tỉ số ${currentScore}.`
        );
      } else {
        lines.push(
          `${scoringSide} tiếp tục nới rộng cách biệt ở phút ${minute}${tag} với pha lập công của ${goal.scorer}${assistText}, nâng tỉ số lên ${currentScore}.`
        );
      }
    }
  });

  if (winner && loserName && events.goals.length > 1) {
    const winnerGoals = events.goals.filter((g) =>
      winner === 1 ? g.side === "home" : g.side === "away"
    ).length;
    const loserGoals = events.goals.length - winnerGoals;
    if (winnerGoals - loserGoals >= 2) {
      lines.push(
        `${winnerName} tạo khoảng cách an toàn với chiến thắng ${formatFootballScore(match)}, ${loserName} không thể gượng lại.`
      );
    }
  }
  return lines.join(" ");
}

function buildFootballMomentumNote(match: FootballMatch, winner: 1 | 2 | null): string {
  if (!winner) return "";
  const winnerName = winner === 1 ? match.home.name : match.away.name;
  const loserName = winner === 1 ? match.away.name : match.home.name;
  const events = match.events;
  if (!events || events.goals.length === 0) {
    return `${winnerName} kiểm soát thế trận tốt hơn, hạn chế tối đa cơ hội của đối thủ và bảo toàn tỉ số ${formatFootballScore(match)}.`;
  }
  // Count lead changes: how many times the lead flipped
  let leadChanges = 0;
  let lastLeader: "home" | "away" | null = null;
  for (const g of events.goals) {
    if (lastLeader !== null && lastLeader !== g.side) leadChanges++;
    lastLeader = g.side;
  }
  if (leadChanges >= 2) {
    return `Trận đấu chứng kiến nhiều lần đổi thế, nhưng ${winnerName} cho thấy bản lĩnh vững vàng hơn ở những thời điểm then chốt, qua đó hạ gục ${loserName}.`;
  }
  return `${winnerName} kiểm soát nhịp độ trận đấu tốt hơn, tận dụng hiệu quả các cơ hội và hạn chế tối đa sai lầm, qua đó giành chiến thắng ${formatFootballScore(match)}.`;
}

function buildFootballContextNote(match: FootballMatch, winner: 1 | 2 | null): string {
  if (!winner) return "";
  const winnerName = winner === 1 ? match.home.name : match.away.name;
  const loserName = winner === 1 ? match.away.name : match.home.name;
  return `Chiến thắng này giúp ${winnerName} có thêm 3 điểm quan trọng, qua đó cải thiện vị trí trên bảng xếp hạng ${match.tournamentName}, trong khi ${loserName} sẽ cần xốc lại tinh thần cho các vòng tiếp theo.`;
}

function fillFootballTemplate(
  template: string,
  match: FootballMatch,
  winner: 1 | 2 | null,
): string {
  const w = winner ?? 1;
  const winnerObj = w === 1 ? match.home : match.away;
  const loserObj = w === 1 ? match.away : match.home;
  const score = formatFootballScore(match);
  const htScore = match.halftimeScore
    ? `${match.halftimeScore.side1}-${match.halftimeScore.side2}`
    : "—";
  const outcomeLabel = match.outcome ? FOOTBALL_OUTCOME_LABELS[match.outcome] || "" : "";
  const stats = match.stats || {};
  const possessionHome = stats.possession?.home ?? 50;
  const possessionAway = stats.possession?.away ?? 50;
  const shotsHome = stats.shots?.home ?? 0;
  const shotsAway = stats.shots?.away ?? 0;
  const shotsOnTargetHome = stats.shotsOnTarget?.home ?? 0;
  const shotsOnTargetAway = stats.shotsOnTarget?.away ?? 0;
  const foulsHome = stats.fouls?.home ?? 0;
  const foulsAway = stats.fouls?.away ?? 0;
  const cornersHome = stats.corners?.home ?? 0;
  const cornersAway = stats.corners?.away ?? 0;
  const yellowHome = stats.yellowCards?.home ?? 0;
  const yellowAway = stats.yellowCards?.away ?? 0;
  const redHome = stats.redCards?.home ?? 0;
  const redAway = stats.redCards?.away ?? 0;

  const winnerGoals = match.events?.goals.filter((g) =>
    w === 1 ? g.side === "home" : g.side === "away"
  ).length ?? 0;
  const goalList = match.events?.goals.map((g) => {
    const sideName = g.side === "home" ? match.home.name : match.away.name;
    const min = g.stoppage ? `${g.minute}+${g.stoppage}` : `${g.minute}`;
    const tag = g.isPenalty ? " (P)" : g.isOwnGoal ? " (OG)" : "";
    return `${sideName} ${min}' ${g.scorer}${tag}`;
  }).join("; ") ?? "";
  const cardList = match.events?.cards.map((c) => {
    const sideName = c.side === "home" ? match.home.name : match.away.name;
    const min = c.stoppage ? `${c.minute}+${c.stoppage}` : `${c.minute}`;
    const colorLabel = c.color === "yellow" ? "thẻ vàng" : c.color === "red" ? "thẻ đỏ" : "thẻ vàng thứ 2";
    return `${sideName} ${min}' ${c.player} (${colorLabel})`;
  }).join("; ") ?? "";

  const replacements: Record<string, string> = {
    "{tournament}": match.tournamentName,
    "{round}": match.round,
    "{venue}": match.venue || "—",
    "{referee}": match.referee || "—",
    "{home}": match.home.name,
    "{homeShort}": match.home.shortName,
    "{homeFull}": match.home.name,
    "{flagHome}": match.home.countryFlag,
    "{away}": match.away.name,
    "{awayShort}": match.away.shortName,
    "{awayFull}": match.away.name,
    "{flagAway}": match.away.countryFlag,
    "{winner}": winnerObj.name,
    "{winnerFull}": winnerObj.name,
    "{winnerShort}": winnerObj.shortName,
    "{loser}": loserObj.name,
    "{loserFull}": loserObj.name,
    "{loserShort}": loserObj.shortName,
    "{score}": score,
    "{htScore}": htScore,
    "{outcomeLabel}": outcomeLabel,
    "{winnerGoals}": String(winnerGoals),
    "{goalList}": goalList || "—",
    "{cardList}": cardList || "—",
    "{goalNarrative}": buildGoalNarrative(match, winner),
    "{momentumNote}": buildFootballMomentumNote(match, winner),
    "{contextNote}": buildFootballContextNote(match, winner),
    "{events}": formatFootballEventsForLLM(match),
    "{possessionHome}": String(possessionHome),
    "{possessionAway}": String(possessionAway),
    "{shotsHome}": String(shotsHome),
    "{shotsAway}": String(shotsAway),
    "{shotsOnTargetHome}": String(shotsOnTargetHome),
    "{shotsOnTargetAway}": String(shotsOnTargetAway),
    "{foulsHome}": String(foulsHome),
    "{foulsAway}": String(foulsAway),
    "{cornersHome}": String(cornersHome),
    "{cornersAway}": String(cornersAway),
    "{yellowHome}": String(yellowHome),
    "{yellowAway}": String(yellowAway),
    "{redHome}": String(redHome),
    "{redAway}": String(redAway),
    "{turningPoint}": "giữa hiệp 2",
  };

  let out = template;
  for (const [key, val] of Object.entries(replacements)) {
    out = out.split(key).join(val);
  }
  return out;
}

function formatFootballEventsForLLM(match: FootballMatch): string {
  const events = match.events;
  if (!events) return "";
  const homeName = match.home.name;
  const awayName = match.away.name;
  const lines: string[] = [];
  lines.push("### Diễn biến trận đấu (từ FlashScore API)");

  if (events.goals.length > 0) {
    lines.push("");
    lines.push("**Bàn thắng:**");
    for (const g of events.goals) {
      const sideName = g.side === "home" ? homeName : awayName;
      const min = g.stoppage ? `${g.minute}+${g.stoppage}` : `${g.minute}`;
      const tag = g.isPenalty ? " (phạt đền)" : g.isOwnGoal ? " (phản lưới)" : "";
      const assistText = g.assist ? `, kiến tạo: ${g.assist}` : "";
      lines.push(`  - Phút ${min}' ${sideName}: ${g.scorer}${tag}${assistText}`);
    }
  }

  if (events.cards.length > 0) {
    lines.push("");
    lines.push("**Thẻ phạt:**");
    for (const c of events.cards) {
      const sideName = c.side === "home" ? homeName : awayName;
      const min = c.stoppage ? `${c.minute}+${c.stoppage}` : `${c.minute}`;
      const colorLabel = c.color === "yellow" ? "thẻ vàng" : c.color === "red" ? "thẻ đỏ" : "thẻ vàng thứ 2";
      lines.push(`  - Phút ${min}' ${sideName}: ${c.player} (${colorLabel})`);
    }
  }

  if (events.subs.length > 0) {
    lines.push("");
    lines.push("**Thay người:**");
    for (const s of events.subs) {
      const sideName = s.side === "home" ? homeName : awayName;
      lines.push(`  - Phút ${s.minute}' ${sideName}: ${s.playerOut} → ${s.playerIn}`);
    }
  }

  const stats = match.stats;
  if (stats) {
    lines.push("");
    lines.push("**Thống kê trận đấu:**");
    if (stats.possession) lines.push(`- Kiểm soát bóng: ${homeName} ${stats.possession.home}% - ${stats.possession.away}% ${awayName}`);
    if (stats.shots) lines.push(`- Số cú sút: ${homeName} ${stats.shots.home} - ${stats.shots.away} ${awayName}`);
    if (stats.shotsOnTarget) lines.push(`- Sút trúng đích: ${homeName} ${stats.shotsOnTarget.home} - ${stats.shotsOnTarget.away} ${awayName}`);
    if (stats.fouls) lines.push(`- Phạm lỗi: ${homeName} ${stats.fouls.home} - ${stats.fouls.away} ${awayName}`);
    if (stats.corners) lines.push(`- Phạt góc: ${homeName} ${stats.corners.home} - ${stats.corners.away} ${awayName}`);
    if (stats.yellowCards) lines.push(`- Thẻ vàng: ${homeName} ${stats.yellowCards.home} - ${stats.yellowCards.away} ${awayName}`);
    if (stats.redCards) lines.push(`- Thẻ đỏ: ${homeName} ${stats.redCards.home} - ${stats.redCards.away} ${awayName}`);
    if (stats.offsides) lines.push(`- Việt vị: ${homeName} ${stats.offsides.home} - ${stats.offsides.away} ${awayName}`);
  }

  return lines.join("\n");
}

function generateFootballTitle(match: FootballMatch, winner: 1 | 2 | null): string {
  if (!winner) return `${match.home.name} vs ${match.away.name}`;
  const winnerObj = winner === 1 ? match.home : match.away;
  const loserObj = winner === 1 ? match.away : match.home;
  const score = formatFootballScore(match);
  const outcomeSuffix = match.outcome === "aet" ? " sau hiệp phụ" : match.outcome === "pen" ? " trên chấm luân lưu" : "";
  const comeback =
    match.events?.goals.some((g) => {
      // crude: if winner scored after being behind (loser scored first)
      return g.side === (winner === 1 ? "away" : "home") && g === match.events!.goals[0];
    }) ?? false;
  if (comeback) {
    return `${winnerObj.name} ngược dòng hạ ${loserObj.name} ${score}${outcomeSuffix} tại ${match.tournamentName}`;
  }
  return `${winnerObj.name} đánh bại ${loserObj.name} ${score}${outcomeSuffix} tại ${match.tournamentName}`;
}

/* ------------------------------------------------------------------ */
/* Sport-dispatching entry points (public API)                         */
/* ------------------------------------------------------------------ */

export function formatSetScore(set: NonNullable<TennisMatch["sets"]>[number]): string {
  return formatTennisSetScore(set);
}

export function formatFullScore(sets: TennisMatch["sets"]): string;
export function formatFullScore(match: Match): string;
export function formatFullScore(input: TennisMatch["sets"] | Match): string {
  if (Array.isArray(input)) return formatTennisFullScore(input as TennisMatch["sets"]);
  if (input && input.sport === "football") return formatFootballScore(input as FootballMatch);
  return formatTennisFullScore((input as TennisMatch).sets);
}

export function getMatchWinner(match: TennisMatch): 1 | 2 | null;
export function getMatchWinner(match: Match): 1 | 2 | null;
export function getMatchWinner(match: Match): 1 | 2 | null {
  if (match.sport === "football") return getFootballWinner(match);
  return getTennisWinner(match);
}

export function getMatchLoser(winner: 1 | 2 | null): 1 | 2 | null {
  if (winner === 1) return 2;
  if (winner === 2) return 1;
  return null;
}

export function getFinalScore(sets: TennisMatch["sets"]): string;
export function getFinalScore(match: Match): string;
export function getFinalScore(input: TennisMatch["sets"] | Match): string {
  if (input == null) return "";
  if (Array.isArray(input)) return formatTennisFullScore(input as TennisMatch["sets"]);
  if (input && input.sport === "football") return formatFootballScore(input as FootballMatch);
  return formatTennisFullScore((input as TennisMatch).sets);
}

export function generateTitle(match: TennisMatch, winner: 1 | 2 | null): string;
export function generateTitle(match: Match, winner: 1 | 2 | null): string;
export function generateTitle(match: Match, winner: 1 | 2 | null): string {
  if (match.sport === "football") return generateFootballTitle(match, winner);
  return generateTennisTitle(match, winner);
}

function fillTemplate(template: string, match: Match, winner: 1 | 2 | null): string {
  if (match.sport === "football") {
    return fillFootballTemplate(template, match, winner);
  }
  return fillTennisTemplate(template, match, winner);
}

/* ------------------------------------------------------------------ */
/* Main generate function                                               */
/* ------------------------------------------------------------------ */

export interface GenerateOptions {
  match: Match;
  templates: ReportTemplate[];
  settings: Settings;
  watchlistId: string;
  triggeredBy?: "auto-on-completion" | "scheduled-batch";
}

export interface ApplyTemplateResult {
  content: string;
  isPrompt: boolean;
  llmError?: string;
  llmModel?: string;
  quality?: ReportQuality;
  /** Match fact record after explicit MCP identity enrichment, if available. */
  enrichedMatch?: Match;
}

/**
 * Report writing is a bounded transformation of a validated evidence
 * envelope. MiniMax adaptive thinking can consume the entire output budget
 * before emitting an article, so keep it for interactive use only and reserve
 * this path's tokens for the JSON envelope and prose.
 */
export function getReportLlmConfig(config: LLMConfig): LLMConfig {
  return {
    ...config,
    maxTokens: Math.min(config.maxTokens ?? LLM_MAX_TOKENS, LLM_MAX_TOKENS),
    enableThinking: false,
  };
}

export async function applyTemplate(
  template: ReportTemplate,
  match: Match,
  llmConfig?: Settings["llm"],
  options?: { signal?: AbortSignal }
): Promise<ApplyTemplateResult> {
  if (template.kind !== "prompt") {
    // Literal templates are deterministic; no validator needed.
    const winner = getMatchWinner(match);
    return {
      content: fillTemplate(template.content, match, winner),
      isPrompt: false,
    };
  }

  // ---- Publication-safe pipeline ----------------------------------
  // 1. Build evidence (without sources initially).
  const baseEvidence: MatchEvidence = buildMatchEvidence(match, []);

  // 2. Recover only missing match evidence through the server-side MCP bridge.
  // This is deliberately deterministic and bounded; the final writer still
  // receives a closed evidence envelope with tools disabled.
  const pipelineStart = Date.now();
  let mcpEvidence: McpEvidence[] = [];
  const mcpRequests = selectMcpRequests(match);
  if (mcpRequests.length > 0) {
    const stageStart = Date.now();
    mcpEvidence = await fetchMcpEvidence(match, { signal: options?.signal });
    // eslint-disable-next-line no-console
    console.log(
      `[generate] match=${match.id} rapid-mcp stage: ${mcpEvidence.length}/${mcpRequests.length} evidence item(s), ` +
      `${(Date.now() - stageStart) / 1000}s`
    );
  }

  const enrichedMatch = applyMcpTennisPointByPoint(
    applyMcpTennisMatchDetails(match, mcpEvidence),
    mcpEvidence,
  );
  const normalizedMcpEvidence = compactMcpEvidenceForReport(enrichedMatch, mcpEvidence);

  // 3. Pre-fetch external sources (only when a Firecrawl key is set).
  let sources: FirecrawlSource[] = [];
  if (llmConfig?.searchApiKey) {
    try {
      const stageStart = Date.now();
      const fetched = await fetchMatchSources({
        apiKey: llmConfig.searchApiKey,
        queries: buildMatchQueries(enrichedMatch),
        signal: options?.signal,
      });
      sources = fetched.sources;
      // eslint-disable-next-line no-console
      console.log(
        `[generate] match=${match.id} firecrawl stage: ${sources.length} source(s), ${(Date.now() - stageStart) / 1000}s, ` +
        `queries=${fetched.metrics.queriesExecuted} scrapes=${fetched.metrics.scrapeSuccesses}/${fetched.metrics.scrapeAttempts}`
      );
    } catch (e) {
      // Soft failure: API-only path is always valid, so an empty
      // sources list is acceptable. Log and continue.
      // eslint-disable-next-line no-console
      console.warn(
        `[generate] firecrawl pre-fetch failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  // Re-build evidence so the JSON envelope includes both verified web excerpts
  // and any bounded, server-fetched Rapid MCP data.
  const evidence: MatchEvidence = sources.length || normalizedMcpEvidence.length
    ? buildMatchEvidence(enrichedMatch, sources, normalizedMcpEvidence)
    : baseEvidence;

  // 3. Build the prompt. The template persona + rules + the JSON
  // envelope go in one document. Tools are disabled by default; the
  // LLM must answer from the envelope alone.
  const persona = template.content.trim();
  const fullPrompt = `${persona}\n${buildPromptContextWithSources(enrichedMatch, sources, normalizedMcpEvidence)}\n`;

  if (!isLLMConfigured(llmConfig)) {
    // No LLM configured — preserve the existing prompt fallback.
    return { content: fullPrompt, isPrompt: true, enrichedMatch };
  }

  // Cap max_tokens per request; the safety budget is small so the
  // validator can reliably re-parse the result.
  const configWithCap = getReportLlmConfig(llmConfig);

  // 4. First call.
  const draftStart = Date.now();
  let lastResult: Awaited<ReturnType<typeof callLLM>> | null = null;
  let lastIssues: ValidationIssue[] = [];
  let repairAttempted = false;
  let repairSucceeded: boolean | undefined;
  let repairTurns = 0;
  let repairDurationMs = 0;

  try {
    lastResult = await callLLM({
      prompt: fullPrompt,
      config: configWithCap,
      disableTools: true,
      signal: options?.signal,
    });
  } catch (e) {
    const msg = e instanceof LLMError ? e.message : e instanceof Error ? e.message : "Lỗi không xác định";
    // eslint-disable-next-line no-console
    console.log(
      `[generate] match=${match.id} LLM first-call failed after ${(Date.now() - draftStart) / 1000}s: ${msg}`
    );
    return { content: fullPrompt, isPrompt: true, llmError: msg, enrichedMatch };
  }
  // eslint-disable-next-line no-console
  console.log(
    `[generate] match=${match.id} LLM first-call ok: ${(Date.now() - draftStart) / 1000}s, ` +
    `turns=${lastResult.observability?.turns ?? 0}, finish=${lastResult.finishReason}`
  );

  let envelope = parseEnvelope(lastResult.content);
  let validation: ValidationResult | null = envelope
    ? validateEnvelope(envelope, evidence, { finishReason: lastResult.finishReason })
    : null;

  // 5. Exactly one repair attempt on blocking failure.
  if (validation && !validation.ok) {
    const startedAt = Date.now();
    const repairPrompt = buildRepairPrompt(
      fullPrompt,
      evidence,
      validation.issues.filter((i) => i.blocking),
      lastResult.finishReason
    );
    repairAttempted = true;
    let repairResult: Awaited<ReturnType<typeof callLLM>> | null = null;
    try {
      repairResult = await callLLM({
        prompt: repairPrompt,
        config: configWithCap,
        disableTools: true,
        signal: options?.signal,
      });
    } catch {
      // Repair failed at the network layer; keep the first attempt.
      lastIssues = validation.issues;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[generate] match=${match.id} LLM repair ok: ${(Date.now() - startedAt) / 1000}s, ` +
      `turns=${repairResult?.observability?.turns ?? 0}, finish=${repairResult?.finishReason ?? "n/a"}`
    );
    repairDurationMs = Date.now() - startedAt;
    repairTurns = repairResult?.observability?.turns ?? 0;
    if (repairResult) {
      const repaired = parseEnvelope(repairResult.content);
      if (repaired) {
        const revalidated = validateEnvelope(repaired, evidence, {
          finishReason: repairResult.finishReason,
        });
        if (revalidated.ok) {
          envelope = repaired;
          validation = revalidated;
          repairSucceeded = true;
          lastIssues = revalidated.issues;
          lastResult = repairResult;
        } else {
          lastIssues = revalidated.issues;
        }
      } else {
        lastIssues = [
          ...validation.issues,
          { code: "envelope_invalid" as const, message: "Repair response không phải JSON envelope hợp lệ", blocking: true },
        ];
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    `[generate] match=${match.id} pipeline done in ${(Date.now() - pipelineStart) / 1000}s, ` +
    `status=${validation?.ok ? "ready" : "needs-review"}`
  );

  const totalObservability = mergeObservability(lastResult?.observability, repairTurns, repairDurationMs);
  const quality: ReportQuality = {
    status: validation?.ok ? "ready" : "needs-review",
    validatedAt: new Date().toISOString(),
    issues: (validation?.issues ?? lastIssues).map((i) => ({
      code: i.code,
      message: i.message,
      blocking: i.blocking,
    })),
    repairAttempted,
    repairSucceeded,
    sourceMode: envelope?.sourceMode ?? (sources.length > 0 ? "api-plus-web" : "api-only"),
    evidenceIdsUsed: envelope?.evidenceIdsUsed ?? ["facts"],
    sources: sources.map((s) => ({
      evidenceId: s.evidenceId,
      url: s.url,
      title: s.title,
      verified: evidence.sources.find((es) => es.evidenceId === s.evidenceId)?.verified ?? false,
    })),
    mcpSources: evidence.mcp.map((item) => ({
      evidenceId: item.evidenceId,
      toolName: item.toolName,
      fetchedAt: item.fetchedAt,
    })),
    validatorVersion: VALIDATOR_VERSION,
    observability: totalObservability,
  };

  if (!envelope) {
    return {
      content: fullPrompt,
      isPrompt: true,
      llmModel: lastResult?.model,
      quality,
      enrichedMatch,
    };
  }

  return {
    content: envelope.articleMarkdown.trim(),
    isPrompt: false,
    llmModel: lastResult?.model,
    quality,
    enrichedMatch,
  };
}

function mergeObservability(
  first: { turns: number; durationMs: number } | undefined,
  repairTurns: number,
  repairDurationMs: number
): ReportQuality["observability"] {
  if (!first) {
    return {
      turns: 0,
      durationMs: 0,
      repairTurns,
      repairDurationMs,
    };
  }
  return {
    turns: first.turns,
    durationMs: first.durationMs,
    repairTurns,
    repairDurationMs,
  };
}

const LLM_PROMPT_TEMPLATE_ID = "tpl-prompt";

export async function generateReport({ match, templates, settings, watchlistId, triggeredBy }: GenerateOptions): Promise<Report> {
  const llmAvailable = isLLMConfigured(settings.llm);

  // Find the right prompt template for this sport's LLM call.
  // Tennis uses tpl-prompt; football uses tpl-football-prompt.
  const sportPromptTemplateId = match.sport === "football" ? "tpl-football-prompt" : LLM_PROMPT_TEMPLATE_ID;
  const sport = match.sport;

  // When LLM is configured, prefer the bundled sport-specific prompt
  // template. Fall back to the user's default if the sport-specific
  // prompt was deleted.
  const template = llmAvailable
    ? templates.find((t) => t.id === sportPromptTemplateId) ?? getDefaultTemplate(templates, sport)
    : getDefaultTemplate(templates, sport);

  const { content, isPrompt, llmError, llmModel, quality, enrichedMatch } = await applyTemplate(
    template,
    match,
    settings.llm,
    { signal: undefined }
  );
  const reportMatch = enrichedMatch ?? match;
  const winner = getMatchWinner(reportMatch);
  const title = generateTitle(reportMatch, winner);
  if (llmAvailable) {
    if (template.id !== sportPromptTemplateId) {
      console.warn(
        `[llm] report match=${match.id} sport=${match.sport} → LLM ENABLED but no "${sportPromptTemplateId}" template. ` +
          `Fell back to template=${template.id} (${isPrompt ? "prompt" : "literal"}). ` +
          `LLM was NOT called.`
      );
    } else {
      console.log(
        `[llm] report match=${match.id} sport=${match.sport} template=${template.id}` +
          (isPrompt
            ? ` → FALLBACK prompt (llmError=${llmError ?? "none"})`
            : ` → LLM response (model=${llmModel ?? "?"})`)
      );
    }
  } else {
    console.log(`[llm] report match=${match.id} sport=${match.sport} template=${template.id} → no LLM configured, ${isPrompt ? "saved as prompt" : "filled literal"}`);
  }
  return {
    id: uid(),
    watchlistId,
    matchApiId: match.id,
    sport,
    title,
    content,
    match: reportMatch,
    generatedAt: new Date().toISOString(),
    isNew: true,
    templateId: template.id,
    isPrompt,
    llmError,
    llmModel,
    quality,
    triggeredBy: triggeredBy ?? "auto-on-completion",
  };
}
