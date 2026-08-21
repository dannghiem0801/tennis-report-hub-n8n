/**
 * Build payload gửi lên backend (POST /api/matches) từ một WatchlistEntry.
 * Format label: "side1 v side2 DD/MM/YYYY | Tennis - Flashscore | Match"
 *
 * Backend TAB_MAP dùng "tennis" → Tennis, "football" → Soccer.
 */
import type { WatchlistEntry, Settings } from "@/types";

const SPORT_TAG: Record<string, string> = {
  tennis: "Tennis - Flashscore",
  football: "Football - Flashscore",
};

export interface SubmitPayload {
  sport: string;
  match: string;
  youtube_link: string;
}

/** Build match label theo chuẩn pipeline sheet. */
function buildLabel(entry: WatchlistEntry, sport: string): string {
  // Nếu có finalScore + winner thì prefix để dễ nhận biết (e.g. "SHE 2-0 SIN | Alcaraz v Sinner 17/08")
  const score = entry.finalScore ? `${entry.finalScore} | ` : "";
  const match = `${entry.side1Name} v ${entry.side2Name} ${entry.matchDate}`;
  if (match.includes("Flashscore")) return match; // đã format rồi
  return `${score}${match} | ${SPORT_TAG[sport] ?? SPORT_TAG.tennis} | Match`;
}

export function buildSubmitPayload(entry: WatchlistEntry, sport: string): SubmitPayload {
  return {
    sport, // "tennis" hoặc "football"
    match: buildLabel(entry, sport),
    youtube_link: (entry as any).youtubeLink ?? "",
  };
}

/** Gate: chỉ submit khi backendEnabled=true VÀ entry.status=completed. */
export function shouldAutoSubmit(entry: WatchlistEntry, settings: Settings): boolean {
  if (settings.backendEnabled !== true) return false;
  return entry.status === "completed";
}
