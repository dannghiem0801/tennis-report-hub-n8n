/**
 * Build payload gửi lên backend (POST /api/matches) từ một Match object.
 * Format label theo chuẩn pipeline Google Sheets:
 *   "SHE 2-0 FAR | Ben Shelton v Jaime Faria 17/08/2026 | Tennis - Flashscore | Match"
 */
import type { Match } from "../types";
import type { Sport } from "../api/backend";

function sportTag(sport: Sport): string {
  return sport === "soccer" ? "Football - Flashscore" : "Tennis - Flashscore";
}

/** Rút 3 chữ cái đầu của tên làm mã (SHE, FAR...) — theo format Flashscore. */
function shortCode(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, "").toUpperCase();
  return letters.slice(0, 3) || "???";
}

function formatDate(startTime: string): string {
  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function buildSubmitPayload(match: Match, sport: Sport): { sport: Sport; match: string; youtube_link: string } {
  const p1 = match.player1.fullName || match.player1.name;
  const p2 = match.player2.fullName || match.player2.name;
  const date = formatDate(match.startTime);

  // Score code: "SHE 2-0 FAR" khi có setsWon
  let scoreCode = "";
  if (match.setsWon) {
    scoreCode = `${shortCode(match.player1.name)} ${match.setsWon.player1}-${match.setsWon.player2} ${shortCode(match.player2.name)} | `;
  }

  const label = `${scoreCode}${p1} v ${p2}${date ? ` ${date}` : ""} | ${sportTag(sport)} | Match`;
  return { sport, match: label, youtube_link: "" };
}

export interface AutoSubmitCheck {
  backendEnabled: boolean;
  entryStatus: string;
  matchStatus: string;
}

/**
 * Quyết định có auto-submit match lên backend pipeline hay không.
 * Chỉ submit khi: backend bật + entry đang pending (chưa generate)
 * + match đã completed + chưa từng submit (entry chưa completed).
 */
export function shouldAutoSubmit({ backendEnabled, entryStatus, matchStatus }: AutoSubmitCheck): boolean {
  if (!backendEnabled) return false;
  if (matchStatus !== "completed") return false;
  // Chỉ submit từ trạng thái pending (chưa bắt đầu pipeline local)
  if (entryStatus !== "pending") return false;
  return true;
}
