import type { Match } from "@/types";

export function formatFinalScore(sets: Match["sets"]): string {
  if (!sets) return "";
  return sets
    .map((s) => {
      const base = `${s.player1}-${s.player2}`;
      return s.tiebreak ? `${base} (${s.tiebreak.player1}-${s.tiebreak.player2})` : base;
    })
    .join(", ");
}
