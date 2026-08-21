/**
 * Build match label theo format pipeline Google Sheets.
 * Ví dụ: "SHE 0-2 FAR | Ben Shelton v Jaime Faria 16/08/2026 | Tennis - Flashscore | Match"
 */

const SPORT_TAGS: Record<string, string> = {
  tennis: "Tennis - Flashscore",
  soccer: "Football - Flashscore",
};

export function buildMatchLabel(sport: string, match: string): string {
  if (match.includes("|")) return match;
  const tag = SPORT_TAGS[sport] ?? SPORT_TAGS.tennis;
  return `${match} | ${tag} | Match`;
}
