import type { FootballMatch, Match, SetScore, TennisMatch } from "@/types";

export function formatFinalScore(input: Match | Match["sets"]): string {
  if (Array.isArray(input)) {
    return formatTennisSets(input as TennisMatch["sets"]);
  }
  const match = input as Match;
  if (match.sport === "football") {
    const fm = match as FootballMatch;
    if (!fm.finalScore) return "";
    return `${fm.finalScore.side1}-${fm.finalScore.side2}`;
  }
  return formatTennisSets((match as TennisMatch).sets);
}

function formatTennisSets(sets: TennisMatch["sets"]): string {
  if (!sets) return "";
  return sets
    .map((s: SetScore) => {
      const base = `${s.player1}-${s.player2}`;
      return s.tiebreak ? `${base} (${s.tiebreak.player1}-${s.tiebreak.player2})` : base;
    })
    .join(", ");
}
