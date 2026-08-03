import type { Match, Report, ReportTemplate, Settings } from "@/types";
import { buildPromptContext, getDefaultTemplate } from "./templates";
import { uid } from "@/lib/utils";
import { callLLM, LLMError } from "@/api/llm";

/* ------------------------------------------------------------------ */
/* Score helpers                                                       */
/* ------------------------------------------------------------------ */

export function formatSetScore(set: NonNullable<Match["sets"]>[number]): string {
  const base = `${set.player1}-${set.player2}`;
  return set.tiebreak
    ? `${base} (${set.tiebreak.player1}-${set.tiebreak.player2})`
    : base;
}

export function formatFullScore(sets: Match["sets"]): string {
  if (!sets) return "";
  return sets.map(formatSetScore).join(", ");
}

export function getMatchWinner(match: Match): 1 | 2 | null {
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

export function getMatchLoser(winner: 1 | 2 | null): 1 | 2 | null {
  if (winner === 1) return 2;
  if (winner === 2) return 1;
  return null;
}

export function getFinalScore(sets: Match["sets"]): string {
  return formatFullScore(sets);
}

/* ------------------------------------------------------------------ */
/* Narrative generation                                                 */
/* ------------------------------------------------------------------ */

const SURFACE_LABELS: Record<string, string> = {
  hard: "cứng",
  clay: "đất nện",
  grass: "cỏ",
};

function buildSetNarrative(match: Match, winner: 1 | 2 | null): string {
  const sets = match.sets || [];
  if (sets.length === 0) return "Trận đấu chưa có dữ liệu set.";

  const winnerName = winner === 1 ? match.player1.fullName : match.player2.fullName;
  const loserName = winner === 1 ? match.player2.fullName : match.player1.fullName;

  const lines: string[] = [];

  sets.forEach((set, i) => {
    const setWinner = set.player1 > set.player2 ? match.player1.fullName : match.player2.fullName;
    const isDecider = sets.length >= 3 && i === sets.length - 1;
    const score = formatSetScore(set);

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
      const comeback = (winner === 1 && set.player1 < set.player2) || (winner === 2 && set.player2 < set.player1);
      lines.push(
        comeback
          ? `${setWinner} đáp trả mạnh mẽ ở set ${i + 1} với tỉ số ${score}, cân bằng thế trận sau khi ${loserName} thắng set trước.`
          : `${setWinner} tiếp tục duy trì sức ép và thắng set ${i + 1} với tỉ số ${score}.`
      );
    }
  });

  return lines.join(" ");
}

function buildMomentumNote(match: Match, winner: 1 | 2 | null): string {
  if (!winner) return "";
  const winnerName = winner === 1 ? match.player1.fullName : match.player2.fullName;
  const loserName = winner === 1 ? match.player2.fullName : match.player1.fullName;
  const sets = match.sets || [];
  // Count momentum swings
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

function buildContextNote(match: Match, winner: 1 | 2 | null): string {
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

function fillTemplate(template: string, match: Match, winner: 1 | 2 | null): string {
  const w = winner ?? 1;
  const winnerObj = w === 1 ? match.player1 : match.player2;
  const loserObj = w === 1 ? match.player2 : match.player1;
  const score = formatFullScore(match.sets);
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
    "{surfaceLabel}": SURFACE_LABELS[match.surface || "hard"],
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
    "{pointByPoint}": formatPointByPointForLLM(match, winner),
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

/* ------------------------------------------------------------------ */
/* Title generation                                                     */
/* ------------------------------------------------------------------ */

export function generateTitle(match: Match, winner: 1 | 2 | null): string {
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

  // When LLM is configured, prefer the bundled prompt template
  // (tpl-prompt) so the LLM gets the persona + structure guidance.
  // The user's "default" template is only used when LLM is NOT
  // configured — otherwise toggling "Auto-generate báo cáo qua LLM"
  // would silently do nothing for users who picked a literal template
  // as default. Fall back to the user's default if tpl-prompt was
  // deleted from their template list.
  const template = llmAvailable
    ? templates.find((t) => t.id === LLM_PROMPT_TEMPLATE_ID) ?? getDefaultTemplate(templates)
    : getDefaultTemplate(templates);

  const winner = getMatchWinner(match);
  const { content, isPrompt, llmError, llmModel } = await applyTemplate(template, match, settings.llm);
  const title = generateTitle(match, winner);

  // Diagnostic: confirm LLM path was taken (or skipped) so it's visible
  // in DevTools why a report came out as prompt vs final article.
  if (llmAvailable) {
    if (template.id !== LLM_PROMPT_TEMPLATE_ID) {
      // User has LLM enabled but deleted tpl-prompt from their list.
      // We silently fell back to their default literal template, so
      // no LLM call happened. Surface this so it's not a black box.
      // eslint-disable-next-line no-console
      console.warn(
        `[llm] report match=${match.id} → LLM ENABLED but no "tpl-prompt" template in user list. ` +
          `Fell back to template=${template.id} (${isPrompt ? "prompt" : "literal"}). ` +
          `LLM was NOT called. To re-enable: clear localStorage or restore tpl-prompt.`
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `[llm] report match=${match.id} template=${template.id}` +
          (isPrompt
            ? ` → FALLBACK prompt (llmError=${llmError ?? "none"})`
            : ` → LLM response (model=${llmModel ?? "?"})`)
      );
    }
  } else {
    // eslint-disable-next-line no-console
    console.log(`[llm] report match=${match.id} template=${template.id} → no LLM configured, ${isPrompt ? "saved as prompt" : "filled literal"}`);
  }

  return {
    id: uid(),
    watchlistId,
    matchApiId: match.id,
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

/**
 * Format point-by-point data into a compact, LLM-friendly text block.
 * Highlights breaks and deuce games (the dramatic moments a reporter
 * would want to mention). Returns an empty string if no PBP data is
 * available — the LLM prompt then falls back to web search for context.
 */
function formatPointByPointForLLM(
  match: Match,
  winner: 1 | 2 | null,
): string {
  const pbp = match.pointByPoint;
  if (!pbp || pbp.sets.length === 0) return "";

  const p1Name = match.player1.fullName;
  const p2Name = match.player2.fullName;
  const lines: string[] = [];

  lines.push("### Diễn biến point-by-point (từ FlashScore API)");

  let totalBreaks = { 1: 0, 2: 0 };
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
      const winner = g.gameWinner === 1 ? p1Name : p2Name;
      const isBreak = g.isBreak !== null;
      const pointCount = g.pointSequence.split(",").filter((p) => p.trim()).length;
      const hasDeuce = pointCount >= 6; // 4-4 (deuce) needs ≥6 points

      if (isBreak) totalBreaks[g.isBreak as 1 | 2]++;
      if (hasDeuce) totalDeuceGames++;
      if (pointCount > longestGamePoints) longestGamePoints = pointCount;

      // Highlight: breaks, deuce games, long games (≥10 points), and last game of set
      const isLastGameOfSet = i === set.games.length - 1;
      const isHighlighted = isBreak || hasDeuce || pointCount >= 10 || isLastGameOfSet;
      if (!isHighlighted) continue;

      const marker = isBreak ? " 🔴 BREAK" : hasDeuce ? " ⏱ Deuce" : pointCount >= 10 ? " ⏳ Long game" : " ✓ Set point";
      lines.push(
        `  Game ${gameNum}: ${server} serve → ${winner} thắng (${g.homeGames}-${g.awayGames})${marker}`
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
