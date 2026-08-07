import type { Match, SetScore, TennisMatch } from "@/types";

/**
 * Format the final score of a tennis match as a comma-separated list
 * of set scores (e.g. "6-4, 3-6, 6-3"). Returns "" if no sets.
 *
 * Sport-aware: when called with a Match (union), it dispatches on
 * `match.sport`:
 *   - tennis → "6-4, 3-6, 6-3" (per-set games)
 *   - football → "2-1" (final score line)
 */
export function formatFinalScore(input: Match | Match["sets"]): string {
  // Legacy overload: sets array (tennis)
  if (Array.isArray(input)) {
    return formatTennisSets(input as TennisMatch["sets"]);
  }
  // Match (discriminated union)
  if (input.sport === "football") {
    if (!input.finalScore) return "";
    return `${input.finalScore.side1}-${input.finalScore.side2}`;
  }
  return formatTennisSets((input as TennisMatch).sets);
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
