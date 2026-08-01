/**
 * Maps livescore6 tennis API response to the app's existing
 * Match / Tournament / Player types.
 *
 * Source shape: src/api/tennis.ts (livescore6.p.rapidapi.com)
 * - Stages: each is a tournament
 *   { Sid, Snm, Cnm, Events: [...] }
 * - Events: each is a match
 *   { Eid, Esd (YYYYMMDDHHMMSS UTC), T1[1..2], T2[1..2],
 *     Tr1S1..S3, Tr2S1..S3, Ewt (1|2), Eps ("FT"|"NS"|"S1"|...),
 *     Esid (1=Not Started, 6=FT, 92+=live set) }
 *
 * Conventions applied:
 * - Doubles: events where T1 or T2 has more than 1 player are kept but
 *   the existing UI is built for 1v1 display, so the mapper drops them
 *   (return null). Singles-only filter.
 * - Set scores: 10+ in either column indicates a super tiebreak
 *   (10-point format used in doubles / deciding set). Map to a 7-6
 *   set with the tiebreak sub-score.
 * - Surface / round / court: not exposed by this API — defaults applied.
 * - Country: not exposed by this API — flag is empty placeholder.
 * - Ranking / seed: not exposed by this API — left undefined.
 */

import type { Match, Player, SetScore, Tournament } from "@/types";
import {
  type ApiEvent,
  type ApiMatchesResponse,
  type ApiStage,
  categoryFromStage,
  parseCompactDateTime,
} from "./tennis";

/* ------------------------------------------------------------------ */
/*  Player helpers                                                     */
/* ------------------------------------------------------------------ */

function deriveShortName(fullName: string): string {
  // "Alex de Minaur" → "A. de Minaur"
  // "Carlos Alcaraz" → "C. Alcaraz"
  // Doubles: "A. Pellegrino / A. Vavassori" — keep as-is
  if (fullName.includes("/")) return fullName;
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  const initial = parts[0].charAt(0).toUpperCase();
  return `${initial}. ${parts[parts.length - 1]}`;
}

function mapApiPlayerToPlayer(team: ApiEvent["T1"]): Player | null {
  if (!team || team.length === 0) return null;
  const p = team[0];
  return {
    name: deriveShortName(p.Nm),
    fullName: p.Nm,
    country: "", // livescore6 doesn't expose country in this endpoint
    countryFlag: "🏳️",
  };
}

/* ------------------------------------------------------------------ */
/*  Set score derivation                                               */
/* ------------------------------------------------------------------ */

function parseSetScore(
  p1: string | undefined,
  p2: string | undefined,
  p1Tiebreak: string | undefined,
  p2Tiebreak: string | undefined,
  isCompleted: boolean
): SetScore | null {
  if (!p1 || !p2) return null;
  const a = parseInt(p1, 10);
  const b = parseInt(p2, 10);
  if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0) return null;

  // Parse tiebreak sub-score (e.g. Tr1S1T="7" → ta=7 in a 7-6(7-3) set).
  // Only present when the set reached a tiebreak.
  const ta = p1Tiebreak ? parseInt(p1Tiebreak, 10) : NaN;
  const tb = p2Tiebreak ? parseInt(p2Tiebreak, 10) : NaN;
  const hasTiebreak = !Number.isNaN(ta) && !Number.isNaN(tb);

  // Super tiebreak (10-point format): either value >= 10 means
  // the set was decided by a 10-point tiebreak.
  if (a >= 10 || b >= 10) {
    if (isCompleted) {
      // Promote to 7-6 with the tiebreak sub-score.
      if (a > b) return { player1: 7, player2: 6, tiebreak: { player1: a, player2: b } };
      if (b > a) return { player1: 6, player2: 7, tiebreak: { player1: a, player2: b } };
      return null; // invalid: tiebreak must have a winner
    }
    // Live: set is in a super-tiebreak right now, not decided yet.
    return { player1: 6, player2: 6, tiebreak: { player1: a, player2: b } };
  }

  // Normal tiebreak (7-point format):
  // - Completed sets at 7-6 / 6-7: the game score is already correct
  //   (API updates the loser side to 6 and the winner side to 7). Just
  //   attach the tiebreak sub-score from Tr*S*T.
  // - Live sets at 6-6: the game score is "6-6" because the set is still
  //   in the tiebreak. Attach the running tiebreak sub-score (may be tied).
  if (isCompleted && (a === 7 || a === 6) && (b === 7 || b === 6) && a + b === 13) {
    if (hasTiebreak) {
      return { player1: a, player2: b, tiebreak: { player1: ta, player2: tb } };
    }
  }
  if (!isCompleted && a === 6 && b === 6 && hasTiebreak) {
    return { player1: 6, player2: 6, tiebreak: { player1: ta, player2: tb } };
  }

  return { player1: a, player2: b };
}

function buildSets(event: ApiEvent): SetScore[] {
  const sets: SetScore[] = [];
  // For tiebreak handling we need to know whether the set is finished.
  // A live set's "6-6" is a tiebreak in progress, not the final game score.
  const isCompleted = event.Esid === 6;
  const t1Games: (string | undefined)[] = [event.Tr1S1, event.Tr1S2, event.Tr1S3];
  const t2Games: (string | undefined)[] = [event.Tr2S1, event.Tr2S2, event.Tr2S3];
  const t1Tb: (string | undefined)[] = [event.Tr1S1T, event.Tr1S2T, event.Tr1S3T];
  const t2Tb: (string | undefined)[] = [event.Tr2S1T, event.Tr2S2T, event.Tr2S3T];
  for (let i = 0; i < 3; i++) {
    const s = parseSetScore(t1Games[i], t2Games[i], t1Tb[i], t2Tb[i], isCompleted);
    if (s) sets.push(s);
  }
  return sets;
}

/* ------------------------------------------------------------------ */
/*  Status mapping                                                    */
/* ------------------------------------------------------------------ */

function statusFromEvent(event: ApiEvent): Match["status"] {
  // Esid values seen in the wild:
  //   1 = Not Started
  //   6 = Full Time (finished)
  //   92..94 = set 1, 2, 3 in progress (live)
  //   Other = treat based on Eps text
  if (event.Esid === 1) return "scheduled";
  if (event.Esid === 6) return "completed";
  if (event.Esid >= 90) return "live";
  // Fallback to Eps text
  const eps = (event.Eps || "").toUpperCase();
  if (eps === "FT" || eps.startsWith("FIN")) return "completed";
  if (eps === "NS" || eps === "TBA" || eps === "POST") return "scheduled";
  if (eps === "CANC" || eps === "ABD" || eps === "WO") return "scheduled";
  if (eps === "LIVE" || eps.startsWith("S") || eps === "1ST SET" || eps === "2ND SET" || eps === "3RD SET") {
    return "live";
  }
  return "scheduled";
}

/* ------------------------------------------------------------------ */
/*  Match                                                              */
/* ------------------------------------------------------------------ */

export function mapEventToMatch(event: ApiEvent, stage: ApiStage): Match | null {
  // Filter out doubles (UI assumes 1v1).
  if (!event.T1 || event.T1.length !== 1) return null;
  if (!event.T2 || event.T2.length !== 1) return null;

  const player1 = mapApiPlayerToPlayer(event.T1);
  const player2 = mapApiPlayerToPlayer(event.T2);
  if (!player1 || !player2) return null;

  const startTime = parseCompactDateTime(event.Esd) ?? new Date().toISOString();
  const sets = buildSets(event);

  return {
    id: String(event.Eid),
    tournamentId: String(stage.Sid),
    tournamentName: stage.Snm,
    tournamentCategory: categoryFromStage(stage),
    round: "—", // not exposed by this API
    startTime,
    status: statusFromEvent(event),
    player1,
    player2,
    sets: sets.length > 0 ? sets : undefined,
    court: undefined,
    surface: "hard", // not exposed; default
  };
}

/* ------------------------------------------------------------------ */
/*  Tournament                                                         */
/* ------------------------------------------------------------------ */

function extractDateFromEvent(event: ApiEvent): string {
  const iso = parseCompactDateTime(event.Esd);
  if (iso) return iso.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

export function mapStageToTournament(stage: ApiStage, fallbackDate: string): Tournament {
  // Try to derive date from the first event's Esd
  const dateFromEvent = stage.Events?.[0]?.Esd
    ? extractDateFromEvent(stage.Events[0])
    : fallbackDate;

  return {
    id: String(stage.Sid),
    name: stage.Snm,
    category: categoryFromStage(stage),
    location: "—", // not exposed
    surface: "hard", // not exposed
    date: dateFromEvent,
  };
}

/* ------------------------------------------------------------------ */
/*  Batch mapper                                                       */
/* ------------------------------------------------------------------ */

export interface MapBatchInput {
  payload: ApiMatchesResponse;
  dateKey: string;
}

export interface MapBatchOutput {
  matches: Match[];
  tournaments: Tournament[];
}

export function mapMatchesBatch(input: MapBatchInput): MapBatchOutput {
  const matches: Match[] = [];
  const tournamentMap = new Map<string, Tournament>();

  for (const stage of input.payload.Stages ?? []) {
    const tournament = mapStageToTournament(stage, input.dateKey);
    if (tournament.id && !tournamentMap.has(tournament.id)) {
      tournamentMap.set(tournament.id, tournament);
    }
    for (const event of stage.Events ?? []) {
      const m = mapEventToMatch(event, stage);
      if (m) matches.push(m);
    }
  }

  return {
    matches,
    tournaments: Array.from(tournamentMap.values()),
  };
}
