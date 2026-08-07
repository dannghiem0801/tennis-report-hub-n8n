import type {
  FootballMatch,
  Match,
  Report,
  ReportTemplate,
  Settings,
  TennisMatch,
} from "@/types";
import { buildPromptContext, getDefaultTemplate } from "./templates";
import { uid } from "@/lib/utils";
import { callLLM, LLMError } from "@/api/llm";

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
      lines.push(
        isDecider
          ? `Set quyết định mở màn với những pha bóng giằng co, ${setWinner} sớm chiếm ưu thế và giành set ${score}.`
          : `${setWinner} chủ động dẫn điểm từ đầu và khép lại set ${score}.`
      );
    } else if (i === sets.length - 1 && isDecider) {
      lines.push(
        `Bước ngoặt đến ở set cuối: ${winnerName} bẻ game quan trọng, tạo khoảng cách an toàn và bảo toàn tỉ số ${score}, chính thức khép lại trận đấu.`
      );
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
    const prev = sets[i - 1];
    const curr = sets[i];
    if ((prev.player1 > prev.player2) !== (curr.player1 > curr.player2)) swings++;
  }
  if (swings >= 2) {
    return `Trận đấu chứng kiến nhiều lần đổi thế, nhưng ${winnerName} cho thấy bản lĩnh vững vàng hơn ở những game then chốt, qua đó hạ gục ${loserName}.`;
  }
  return `${winnerName} kiểm soát nhịp độ trận đấu tốt hơn, hạn chế tối đa những sai lầm không đáng có và tận dụng tốt cơ hội của mình.`;
}

function buildContextNote(match: TennisMatch, winner: 1 | 2 | null): string {
  if (!winner) return "";
  const winnerObj = winner === 1 ? match.player1 : match.player2;
  const loserObj = winner === 1 ? match.player2 : match.player1;
  const winnerRank = winnerObj.ranking;
  const loserRank = loserObj.ranking;
  if (!winnerRank || !loserRank) {
    return `Chiến thắng này giúp ${winnerObj.fullName} tiếp tục duy trì phong độ ổn định trong mùa giải.`;
  }
  if (winnerRank < loserRank) {
    return `Với chiến thắng này, tay vợt hạng ${winnerRank} thế giới ${winnerObj.fullName} tiếp tục khẳng định vị trí trước đối thủ xếp hạng ${loserRank}.`;
  }
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
  const winnerSetCount = sets.filter((s) =>
    winner === 1 ? s.player1 > s.player2 : s.player2 > s.player1
  ).length;
  const loserSetCount = sets.length - winnerSetCount;
  const wentTo3 = sets.length === 3;
  const isComeback =
    wentTo3 &&
    sets[0][winner === 1 ? "player2" : "player1"] >
      sets[0][winner === 1 ? "player1" : "player2"];

  if (isComeback) {
    return `${winnerObj.fullName} ngược dòng hạ ${loserObj.fullName} sau ${sets.length} set tại ${match.tournamentName.split("—")[1]?.trim() || match.tournamentName}`;
  }
  if (wentTo3) {
    return `${winnerObj.fullName} thắng kịch tính ${loserObj.fullName} ${winnerSetCount}-${loserSetCount} tại ${match.tournamentName.split("—")[1]?.trim() || match.tournamentName}`;
  }
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
      const prevSide = prev.side === "home" ? homeName : awayName;
      const isEqualizer = goal.side !== prev.side;
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
  if (input.sport === "football") return formatFootballScore(input);
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
  if (Array.isArray(input)) return formatTennisFullScore(input as TennisMatch["sets"]);
  if (input.sport === "football") return formatFootballScore(input);
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
  /**
   * Which trigger called this generation. Stamped onto the resulting
   * Report.triggeredBy for audit ("this came from the scheduled-batch
   * safety-net, not the auto-on-completion baseline"). Defaults to
   * "auto-on-completion" for backward compat with existing call sites
   * that don't pass it.
   *
   * See ADR 0001 — the batch runner is the only expected caller that
   * passes "scheduled-batch".
   */
  triggeredBy?: "auto-on-completion" | "scheduled-batch";
}

/**
 * Apply a template to a match. Two template kinds are supported:
 * - "literal": classic placeholder substitution (deterministic, no LLM).
 * - "prompt" : few-shot prompt + structured match context appended. The
 *              result is a "ready-to-paste" prompt for any LLM.
 *
 * For "prompt" templates, when LLM is configured, the LLM is called
 * synchronously here and the response becomes the report content (so
 * the report is no longer a "prompt" — it's the final article).
 * On any LLM failure, the prompt + context is saved as a fallback so
 * the user can still copy-paste manually; `llmError` carries the reason.
 */
export async function applyTemplate(
  template: ReportTemplate,
  match: Match,
  llmConfig?: Settings["llm"]
): Promise<{ content: string; isPrompt: boolean; llmError?: string; llmModel?: string }> {
  if (template.kind === "prompt") {
    const fullPrompt = `${template.content.trim()}\n${buildPromptContext(match)}\n`;
    if (llmConfig?.enabled && llmConfig.apiKey && llmConfig.model) {
      try {
        const result = await callLLM({ prompt: fullPrompt, config: llmConfig });
        return { content: result.content.trim(), isPrompt: false, llmModel: result.model };
      } catch (e) {
        const msg = e instanceof LLMError ? e.message : e instanceof Error ? e.message : "Lỗi không xác định";
        return {
          content: fullPrompt,
          isPrompt: true,
          llmError: msg,
        };
      }
    }
    return { content: fullPrompt, isPrompt: true };
  }
  const winner = getMatchWinner(match);
  return {
    content: fillTemplate(template.content, match, winner),
    isPrompt: false,
  };
}

/**
 * The id of the bundled prompt template we want to use for LLM calls.
 * Exposed as a constant so generateReport can find it even if the user
 * has marked a different template as "default" in the Templates page.
 */
const LLM_PROMPT_TEMPLATE_ID = "tpl-prompt";

export async function generateReport({ match, templates, settings, watchlistId, triggeredBy }: GenerateOptions): Promise<Report> {
  const llmAvailable = !!(
    settings.llm?.enabled &&
    settings.llm.apiKey &&
    settings.llm.model
  );

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

  const winner = getMatchWinner(match);
  const { content, isPrompt, llmError, llmModel } = await applyTemplate(template, match, settings.llm);
  const title = generateTitle(match, winner);

  // Diagnostic: confirm LLM path was taken (or skipped) so it's visible
  // in DevTools why a report came out as prompt vs final article.
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
    match,
    generatedAt: new Date().toISOString(),
    isNew: true,
    templateId: template.id,
    isPrompt,
    llmError,
    llmModel,
    triggeredBy: triggeredBy ?? "auto-on-completion",
  };
}
