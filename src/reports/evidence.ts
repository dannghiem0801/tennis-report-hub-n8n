/**
 * MatchEvidence — the typed contract that replaces the lossy aggregate
 * context the previous prompts used to receive.
 *
 * Each sport returns a discriminated union member. Every field is
 * explicitly marked as either authoritative (sourced from the live
 * API), optional (filled only when data is present), or "unknown"
 * when the API didn't ship the value. The validator in
 * `validate.ts` rejects drafts that invent numbers, names, or score
 * forms that disagree with this evidence.
 *
 * Sport-specific rules:
 *
 *  - Tennis:
 *      * If any PBP invariant fails (cumulative game score disagrees
 *        with gameWinner, server/break relationship, final set scores
 *        do not produce the reported match result), the entire
 *        `tacticalTimeline` is dropped and a `limitations` entry is
 *        recorded. The match is then written from aggregate-level
 *        facts only.
 *      * "successful breaks" and "break-point opportunities" are kept
 *        as two separate counts. Aggregations that conflate them are
 *        rejected.
 *
 *  - Football:
 *      * Final/halftime scores, winner, and event side/minute must
 *        reconcile. Contradictory events (e.g. goals that would push
 *        the score past the reported final) are dropped from
 *        `matchEvents` and recorded in `limitations`.
 */

import type {
  FootballEvents,
  FootballMatch,
  Match,
  PointByPointData,
  TennisMatch,
  TennisMatchStats,
} from "@/types";
import type { FirecrawlSource } from "@/api/firecrawl";

/** Stable identifier for a piece of evidence that can be cited. The
 *  format is `<bucket>-<index>`, e.g. `facts`, `tactical-0`,
 *  `web-0`. */
export type EvidenceId = string;

/** Evidence about a tennis match. */
export interface TennisMatchEvidence {
  sport: "tennis";
  evidenceIds: EvidenceId[];
  /** Authoritative facts (participants, competition, round, start
   *  time, status, winner, final score). These always come from the
   *  live API; UI-side text is never trusted. */
  facts: {
    tournamentName: string;
    round: string;
    startTime: string; // ISO
    status: "scheduled" | "live" | "completed";
    surface: "hard" | "clay" | "grass" | "unknown";
    player1: { name: string; fullName: string; country: string; ranking: number | null; seed: number | null };
    player2: { name: string; fullName: string; country: string; ranking: number | null; seed: number | null };
    winnerSide: 1 | 2 | null;
    finalScore: { player1: number; player2: number }[] | null;
    /** The same set scores with the winner's games first, for report prose. */
    winnerScore: { winner: number; loser: number }[] | null;
    matchDurationMinutes: number | null;
  };
  /** Sanitized statistics. Every value is finite, non-negative, and
   *  percentages are 0-100. Break opportunities count is kept
   *  separate from successful breaks. */
  statistics: TennisStatFacts | null;
  /** Game-by-game breakdown, present only when invariants pass. */
  tacticalTimeline: TennisTacticalTimeline | null;
  /** One deterministic, game-level fact per set that the writer must cover
   * when a validated tactical timeline is available. This prevents a generic
   * scorecard from discarding the match's actual turning points. */
  narrativePlan: TennisNarrativePlan | null;
  /** External sources we pre-fetched. */
  sources: ExternalSourceEvidence[];
  /** Missing match data fetched through the server-side RapidAPI MCP bridge. */
  mcp: McpEvidence[];
  /** Free-form notes about data quality. Empty when nothing to flag. */
  limitations: string[];
}

export interface TennisStatFacts {
  aces: { player1: number; player2: number };
  doubleFaults: { player1: number; player2: number };
  firstServePct: { player1: number; player2: number };
  /** Successfully converted break points. Distinct from opportunities. */
  successfulBreaks: { player1: number; player2: number };
  /** Total break-point opportunities faced. Distinct from conversions. */
  breakPointOpportunities: { player1: number; player2: number };
  totalPointsWon: { player1: number; player2: number };
  matchDurationMinutes: number | null;
}

export interface TennisTacticalTimeline {
  sets: Array<{
    setNumber: number;
    games: Array<{
      gameNumber: number;
      server: 1 | 2;
      winner: 1 | 2;
      isBreak: boolean;
      pointCount: number;
      hadDeuce: boolean;
      finalScore: { player1: number; player2: number };
    }>;
    finalScore: { player1: number; player2: number };
  }>;
}

export interface TennisNarrativePlan {
  sets: Array<{
    setNumber: number;
    winner: 1 | 2;
    finalScore: { player1: number; player2: number };
    /** The last verified break in the set is a safe concrete turning point.
     * A set without a break but ending 7-6 must be described as a tiebreak. */
    requiredBeat:
      | {
          type: "break";
          gameNumber: number;
          byPlayer: 1 | 2;
          scoreAfter: { player1: number; player2: number };
        }
      | { type: "tiebreak" }
      | {
          type: "set_finish";
          gameNumber: number;
          byPlayer: 1 | 2;
          scoreAfter: { player1: number; player2: number };
        };
  }>;
}

/** Evidence about a football match. */
export interface FootballMatchEvidence {
  sport: "football";
  evidenceIds: EvidenceId[];
  facts: {
    tournamentName: string;
    round: string;
    startTime: string; // ISO
    status: "scheduled" | "live" | "completed";
    home: { name: string; shortName: string; country: string };
    away: { name: string; shortName: string; country: string };
    winnerSide: 1 | 2 | null;
    finalScore: { home: number; away: number } | null;
    halftimeScore: { home: number; away: number } | null;
    outcome: "normal" | "aet" | "pen" | "retired" | "walkover" | "cancelled" | "abandoned" | "unknown";
  };
  /** Statistics with the same finite, non-negative rules. Percentages
   *  are 0-100. */
  statistics: FootballStatFacts | null;
  /** Events (goals / cards / subs) that survive validation. */
  matchEvents: FootballEvents | null;
  /** External sources. */
  sources: ExternalSourceEvidence[];
  /** Missing match data fetched through the server-side RapidAPI MCP bridge. */
  mcp: McpEvidence[];
  limitations: string[];
}

export interface FootballStatFacts {
  possession: { home: number; away: number } | null;
  shots: { home: number; away: number } | null;
  shotsOnTarget: { home: number; away: number } | null;
  fouls: { home: number; away: number } | null;
  corners: { home: number; away: number } | null;
  yellowCards: { home: number; away: number } | null;
  redCards: { home: number; away: number } | null;
  offsides: { home: number; away: number } | null;
}

export interface ExternalSourceEvidence {
  evidenceId: EvidenceId;
  url: string;
  title: string;
  /** Pre-truncated excerpt body. Never null. */
  excerpt: string;
  /** Did the system verify that this source mentions BOTH participants
   *  and at least one canonical score form? */
  verified: boolean;
}

/** Read-only data returned by the server-side RapidAPI MCP bridge. */
export interface McpEvidence {
  evidenceId: EvidenceId;
  toolName: string;
  fetchedAt: string;
  /** Bounded tool-returned JSON/text. Claims must be supported by this data. */
  content: string;
}

export type MatchEvidence = TennisMatchEvidence | FootballMatchEvidence;

// ---- Helpers --------------------------------------------------------------

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function nonNegInt(n: unknown): number | null {
  if (!isFiniteNumber(n)) return null;
  if (n < 0) return null;
  return Math.trunc(n);
}

function pct(n: unknown): number | null {
  if (!isFiniteNumber(n)) return null;
  if (n < 0 || n > 100) return null;
  return Math.round(n * 10) / 10;
}

/** Build canonical score forms a web source might mention. Used by
 *  the external-source verifier. */
export function canonicalScoreForms(match: Match): string[] {
  if (match.sport === "tennis") {
    if (!match.sets || match.sets.length === 0) return [];
    return [
      match.sets.map((s) => `${s.player1}-${s.player2}`).join(", "),
      match.sets
        .map((s) =>
          s.tiebreak
            ? `${s.player1}-${s.player2} (${s.tiebreak.player1}-${s.tiebreak.player2})`
            : `${s.player1}-${s.player2}`
        )
        .join(", "),
    ];
  }
  if (match.sport === "football" && match.finalScore) {
    return [`${match.finalScore.side1}-${match.finalScore.side2}`];
  }
  return [];
}

/** Check whether an excerpt plausibly confirms a match: must mention
 *  both participants and at least one canonical score form (or an
 *  obvious synonym like "final score" plus a score shape). Conservative
 *  on purpose — unverified sources are still kept but flagged. */
export function verifySourceForMatch(source: { title: string; excerpt: string }, match: Match): boolean {
  const text = `${source.title}\n${source.excerpt}`.toLowerCase();
  const scoreForms = canonicalScoreForms(match).map((s) => s.toLowerCase());
  const participants =
    match.sport === "tennis"
      ? [match.player1.fullName, match.player2.fullName, match.player1.name, match.player2.name]
      : match.sport === "football"
        ? [match.home.name, match.away.name, match.home.shortName, match.away.shortName]
        : [];
  const participantsMentioned = participants.filter((p) => p && text.includes(p.toLowerCase())).length;
  const scoreMentioned = scoreForms.some((form) => text.includes(form));
  // Need at least both participants AND a score form. Be lenient on
  // participant count for short excerpts but require both participants
  // for tennis (no nickname overlap risk) and at least one for football.
  if (match.sport === "tennis") {
    return participantsMentioned >= 2 && scoreMentioned;
  }
  return participantsMentioned >= 1 && scoreMentioned;
}

// ---- Tennis evidence builder ---------------------------------------------

interface TennisPbpIssue {
  code: string;
  detail: string;
}

function validateTennisPbp(pbp: PointByPointData): { ok: true; timeline: TennisTacticalTimeline } | { ok: false; issues: TennisPbpIssue[] } {
  const issues: TennisPbpIssue[] = [];
  const sets: TennisTacticalTimeline["sets"] = [];

  for (const set of pbp.sets) {
    let p1Games = 0;
    let p2Games = 0;
    let prevP1 = 0;
    let prevP2 = 0;
    const games: TennisTacticalTimeline["sets"][number]["games"] = [];

    for (let i = 0; i < set.games.length; i++) {
      const g = set.games[i];
      const pointCount = g.pointSequence
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean).length;
      const hadDeuce = pointCount >= 6;
      const isBreak = g.isBreak === 1 || g.isBreak === 2;
      // Server/break relationship: if the server != winner, that game was a break.
      const inferredBreak = g.server !== g.gameWinner;
      if (isBreak !== inferredBreak) {
        issues.push({
          code: "pbp_break_mismatch",
          detail: `set ${set.setNumber} game ${i + 1}: server=${g.server} winner=${g.gameWinner} isBreak=${g.isBreak} inferredBreak=${inferredBreak}`,
        });
        return { ok: false, issues };
      }
      // Cumulative game score must move monotonically by 1.
      if (g.homeGames < prevP1 || g.awayGames < prevP2) {
        issues.push({
          code: "pbp_cumulative_regression",
          detail: `set ${set.setNumber} game ${i + 1}: cumulative score went backward (${prevP1}-${prevP2} -> ${g.homeGames}-${g.awayGames})`,
        });
        return { ok: false, issues };
      }
      if (g.homeGames - prevP1 > 1 || g.awayGames - prevP2 > 1) {
        issues.push({
          code: "pbp_cumulative_jump",
          detail: `set ${set.setNumber} game ${i + 1}: cumulative score jumped (${prevP1}-${prevP2} -> ${g.homeGames}-${g.awayGames})`,
        });
        return { ok: false, issues };
      }
      // Each game must increment exactly one side.
      const inc1 = g.homeGames - prevP1;
      const inc2 = g.awayGames - prevP2;
      if (inc1 + inc2 !== 1) {
        issues.push({
          code: "pbp_game_no_winner",
          detail: `set ${set.setNumber} game ${i + 1}: neither side incremented (delta ${inc1}-${inc2})`,
        });
        return { ok: false, issues };
      }
      // The incrementing side must match the gameWinner.
      const incSide: 1 | 2 = inc1 === 1 ? 1 : 2;
      if (incSide !== g.gameWinner) {
        issues.push({
          code: "pbp_winner_mismatch",
          detail: `set ${set.setNumber} game ${i + 1}: increment side=${incSide} but game_winner=${g.gameWinner}`,
        });
        return { ok: false, issues };
      }
      prevP1 = g.homeGames;
      prevP2 = g.awayGames;
      if (incSide === 1) p1Games++;
      else p2Games++;
      games.push({
        gameNumber: i + 1,
        server: g.server,
        winner: g.gameWinner,
        isBreak,
        pointCount,
        hadDeuce,
        finalScore: { player1: g.homeGames, player2: g.awayGames },
      });
    }

    // Set's last cumulative score must match the sum of game winners.
    const lastGame = set.games[set.games.length - 1];
    if (!lastGame) {
      issues.push({
        code: "pbp_empty_set",
        detail: `set ${set.setNumber}: no games`,
      });
      return { ok: false, issues };
    }
    if (lastGame.homeGames !== p1Games || lastGame.awayGames !== p2Games) {
      issues.push({
        code: "pbp_set_score_mismatch",
        detail: `set ${set.setNumber}: cumulative ${lastGame.homeGames}-${lastGame.awayGames} != game winner sum ${p1Games}-${p2Games}`,
      });
      return { ok: false, issues };
    }

    sets.push({
      setNumber: set.setNumber,
      games,
      finalScore: { player1: p1Games, player2: p2Games },
    });
  }

  return { ok: true, timeline: { sets } };
}

function buildTennisNarrativePlan(timeline: TennisTacticalTimeline | null): TennisNarrativePlan | null {
  if (!timeline || timeline.sets.length === 0) return null;

  return {
    sets: timeline.sets.map((set) => {
      const winner: 1 | 2 = set.finalScore.player1 > set.finalScore.player2 ? 1 : 2;
      const lastBreak = [...set.games].reverse().find((game) => game.isBreak);
      let requiredBeat: TennisNarrativePlan["sets"][number]["requiredBeat"];

      if (lastBreak) {
        requiredBeat = {
          type: "break",
          gameNumber: lastBreak.gameNumber,
          byPlayer: lastBreak.winner,
          scoreAfter: lastBreak.finalScore,
        };
      } else if (
        (set.finalScore.player1 === 7 && set.finalScore.player2 === 6) ||
        (set.finalScore.player1 === 6 && set.finalScore.player2 === 7)
      ) {
        requiredBeat = { type: "tiebreak" };
      } else {
        const finalGame = set.games[set.games.length - 1]!;
        requiredBeat = {
          type: "set_finish",
          gameNumber: finalGame.gameNumber,
          byPlayer: finalGame.winner,
          scoreAfter: finalGame.finalScore,
        };
      }

      return {
        setNumber: set.setNumber,
        winner,
        finalScore: set.finalScore,
        requiredBeat,
      };
    }),
  };
}

function buildTennisStatistics(stats: TennisMatchStats | undefined): TennisStatFacts | null {
  if (!stats) return null;
  const a = nonNegInt(stats.aces?.player1);
  const a2 = nonNegInt(stats.aces?.player2);
  const df = nonNegInt(stats.doubleFaults?.player1);
  const df2 = nonNegInt(stats.doubleFaults?.player2);
  const fs1 = pct(stats.firstServePct?.player1);
  const fs2 = pct(stats.firstServePct?.player2);
  const breaksConv = nonNegInt(stats.breakPointsConverted?.player1);
  const breaksConv2 = nonNegInt(stats.breakPointsConverted?.player2);
  const breaksOpp = nonNegInt(stats.breakPointsFaced?.player1);
  const breaksOpp2 = nonNegInt(stats.breakPointsFaced?.player2);
  const tpw1 = nonNegInt(stats.totalPointsWon?.player1);
  const tpw2 = nonNegInt(stats.totalPointsWon?.player2);
  const dur = nonNegInt(stats.matchDurationMinutes);
  // Reject if all primary fields are missing.
  if (
    a === null && a2 === null && df === null && df2 === null &&
    fs1 === null && fs2 === null && breaksConv === null && breaksConv2 === null
  ) {
    return null;
  }
  // Converted breaks cannot exceed opportunities.
  if (breaksConv !== null && breaksOpp !== null && breaksConv > breaksOpp) {
    return null;
  }
  if (breaksConv2 !== null && breaksOpp2 !== null && breaksConv2 > breaksOpp2) {
    return null;
  }
  return {
    aces: { player1: a ?? 0, player2: a2 ?? 0 },
    doubleFaults: { player1: df ?? 0, player2: df2 ?? 0 },
    firstServePct: { player1: fs1 ?? 0, player2: fs2 ?? 0 },
    successfulBreaks: { player1: breaksConv ?? 0, player2: breaksConv2 ?? 0 },
    breakPointOpportunities: { player1: breaksOpp ?? 0, player2: breaksOpp2 ?? 0 },
    totalPointsWon: { player1: tpw1 ?? 0, player2: tpw2 ?? 0 },
    matchDurationMinutes: dur,
  };
}

export function buildTennisEvidence(
  match: TennisMatch,
  sources: FirecrawlSource[],
  mcpEvidence: McpEvidence[] = []
): TennisMatchEvidence {
  const evidenceIds: EvidenceId[] = ["facts"];
  const limitations: string[] = [];

  // ---- facts ----
  const sets = match.sets && match.sets.length > 0 ? match.sets : null;
  const finalScore = sets
    ? sets.map((s) => ({ player1: s.player1, player2: s.player2 }))
    : null;
  let winnerSide: 1 | 2 | null = null;
  if (sets && match.status === "completed") {
    let p1 = 0;
    let p2 = 0;
    for (const s of sets) {
      if (s.player1 > s.player2) p1++;
      else if (s.player2 > s.player1) p2++;
    }
    if (p1 > p2) winnerSide = 1;
    else if (p2 > p1) winnerSide = 2;
  }
  // Cross-check the finalScore against setsWon when present.
  if (sets && match.setsWon) {
    const w1 = sets.filter((s) => s.player1 > s.player2).length;
    const w2 = sets.length - w1;
    if (match.setsWon.side1 !== w1 || match.setsWon.side2 !== w2) {
      limitations.push("setsWon disagreement with per-set scores");
    }
  }
  const facts = {
    tournamentName: match.tournamentName,
    round: match.round,
    startTime: match.startTime,
    status: match.status,
    surface: (match.surface ?? "unknown") as "hard" | "clay" | "grass" | "unknown",
    player1: {
      name: match.player1.name,
      fullName: match.player1.fullName,
      country: match.player1.country,
      ranking: isFiniteNumber(match.player1.ranking) ? match.player1.ranking : null,
      seed: isFiniteNumber(match.player1.seed) ? match.player1.seed : null,
    },
    player2: {
      name: match.player2.name,
      fullName: match.player2.fullName,
      country: match.player2.country,
      ranking: isFiniteNumber(match.player2.ranking) ? match.player2.ranking : null,
      seed: isFiniteNumber(match.player2.seed) ? match.player2.seed : null,
    },
    tournamentCategory: match.tournamentCategory,
    winnerSide,
    finalScore,
    winnerScore: finalScore && winnerSide
      ? finalScore.map((set) => winnerSide === 1
        ? { winner: set.player1, loser: set.player2 }
        : { winner: set.player2, loser: set.player1 })
      : null,
    matchDurationMinutes: isFiniteNumber(match.stats?.matchDurationMinutes)
      ? match.stats.matchDurationMinutes
      : null,
  };

  // ---- statistics ----
  const statistics = buildTennisStatistics(match.stats);

  // ---- tactical timeline ----
  let tacticalTimeline: TennisTacticalTimeline | null = null;
  if (match.pointByPoint && match.pointByPoint.sets.length > 0) {
    evidenceIds.push("tacticalTimeline");
    const validated = validateTennisPbp(match.pointByPoint);
    if (validated.ok) {
      tacticalTimeline = validated.timeline;
    } else {
      limitations.push(`pbp_invalid:${validated.issues.map((i) => i.code).join(",")}`);
      for (const i of validated.issues) {
        if (i.detail) limitations.push(`pbp_detail:${i.detail}`);
      }
    }
  }
  const narrativePlan = buildTennisNarrativePlan(tacticalTimeline);

  // ---- sources ----
  const externalSources: ExternalSourceEvidence[] = sources.map((s) => ({
    evidenceId: s.evidenceId,
    url: s.url,
    title: s.title,
    excerpt: s.excerpt,
    verified: verifySourceForMatch({ title: s.title, excerpt: s.excerpt }, match),
  }));
  for (const s of externalSources) evidenceIds.push(s.evidenceId);
  const mcp = sanitizeMcpEvidence(mcpEvidence);
  for (const item of mcp) evidenceIds.push(item.evidenceId);

  return {
    sport: "tennis",
    evidenceIds,
    facts,
    statistics,
    tacticalTimeline,
    narrativePlan,
    sources: externalSources,
    mcp,
    limitations,
  };
}

// ---- Football evidence builder -------------------------------------------

function buildFootballStatistics(match: FootballMatch): FootballStatFacts | null {
  const s = match.stats;
  if (!s) return null;
  const pair = (v: { home?: number; away?: number } | undefined): { home: number; away: number } | null => {
    if (!v) return null;
    const h = nonNegInt(v.home);
    const a = nonNegInt(v.away);
    if (h === null && a === null) return null;
    return { home: h ?? 0, away: a ?? 0 };
  };
  const possession = s.possession
    ? {
        home: pct(s.possession.home) ?? 0,
        away: pct(s.possession.away) ?? 0,
      }
    : null;
  if (possession && Math.abs(possession.home - 100) + Math.abs(possession.away - 100) > 1) {
    // Possession doesn't sum to ~100: treat as missing.
    return null;
  }
  const result: FootballStatFacts = {
    possession,
    shots: pair(s.shots),
    shotsOnTarget: pair(s.shotsOnTarget),
    fouls: pair(s.fouls),
    corners: pair(s.corners),
    yellowCards: pair(s.yellowCards),
    redCards: pair(s.redCards),
    offsides: pair(s.offsides),
  };
  const anyValue = Object.values(result).some(
    (v) => v !== null && (v.home > 0 || v.away > 0)
  );
  return anyValue ? result : null;
}

function validateFootballEvents(
  events: FootballEvents | undefined,
  finalHome: number | null,
  finalAway: number | null
): { ok: true; events: FootballEvents } | { ok: false; issues: string[]; events: FootballEvents } {
  if (!events) return { ok: true, events: { goals: [], cards: [], subs: [] } };
  const issues: string[] = [];
  let homeGoals = 0;
  let awayGoals = 0;
  const goals: typeof events.goals = [];
  for (const g of events.goals) {
    if (g.side === "home") homeGoals++;
    else awayGoals++;
    // Goals must not exceed final score; otherwise the event is
    // contradictory.
    if (finalHome !== null && homeGoals > finalHome) {
      issues.push(`extra_home_goal@${g.minute}`);
      homeGoals--;
      continue;
    }
    if (finalAway !== null && awayGoals > finalAway) {
      issues.push(`extra_away_goal@${g.minute}`);
      awayGoals--;
      continue;
    }
    goals.push(g);
  }
  const cards: typeof events.cards = [];
  for (const c of events.cards) {
    if (typeof c.minute !== "number" || !Number.isFinite(c.minute) || c.minute < 0 || c.minute > 200) {
      issues.push(`invalid_card_minute@${String(c.minute)}`);
      continue;
    }
    cards.push(c);
  }
  const subs: typeof events.subs = [];
  for (const s of events.subs) {
    if (typeof s.minute !== "number" || !Number.isFinite(s.minute) || s.minute < 0 || s.minute > 200) {
      issues.push(`invalid_sub_minute@${String(s.minute)}`);
      continue;
    }
    subs.push(s);
  }
  if (finalHome !== null && homeGoals !== finalHome) {
    issues.push("event_goal_total_mismatch_home");
  }
  if (finalAway !== null && awayGoals !== finalAway) {
    issues.push("event_goal_total_mismatch_away");
  }
  return { ok: issues.length === 0, events: { goals, cards, subs }, issues };
}

export function buildFootballEvidence(
  match: FootballMatch,
  sources: FirecrawlSource[],
  mcpEvidence: McpEvidence[] = []
): FootballMatchEvidence {
  const evidenceIds: EvidenceId[] = ["facts"];
  const limitations: string[] = [];

  const finalHome = match.finalScore ? nonNegInt(match.finalScore.side1) : null;
  const finalAway = match.finalScore ? nonNegInt(match.finalScore.side2) : null;
  let winnerSide: 1 | 2 | null = null;
  if (match.status === "completed" && finalHome !== null && finalAway !== null) {
    if (finalHome > finalAway) winnerSide = 1;
    else if (finalAway > finalHome) winnerSide = 2;
  }

  const halftimeHome = match.halftimeScore ? nonNegInt(match.halftimeScore.side1) : null;
  const halftimeAway = match.halftimeScore ? nonNegInt(match.halftimeScore.side2) : null;
  if (
    halftimeHome !== null && halftimeAway !== null &&
    finalHome !== null && finalAway !== null &&
    (halftimeHome > finalHome || halftimeAway > finalAway)
  ) {
    limitations.push("halftime_exceeds_final");
  }

  const facts = {
    tournamentName: match.tournamentName,
    round: match.round,
    startTime: match.startTime,
    status: match.status,
    home: { name: match.home.name, shortName: match.home.shortName, country: match.home.country },
    away: { name: match.away.name, shortName: match.away.shortName, country: match.away.country },
    tournamentCategory: match.tournamentCategory,
    winnerSide,
    finalScore: finalHome !== null && finalAway !== null ? { home: finalHome, away: finalAway } : null,
    halftimeScore: halftimeHome !== null && halftimeAway !== null ? { home: halftimeHome, away: halftimeAway } : null,
    outcome: (match.outcome ?? "normal") as
      | "normal"
      | "aet"
      | "pen"
      | "retired"
      | "walkover"
      | "cancelled"
      | "abandoned"
      | "unknown",
  };

  const statistics = buildFootballStatistics(match);
  if (statistics === null) evidenceIds.push("statistics-null");

  let matchEvents: FootballEvents | null = null;
  if (match.events) {
    evidenceIds.push("matchEvents");
    const validated = validateFootballEvents(match.events, finalHome, finalAway);
    matchEvents = validated.events;
    if (!validated.ok) {
      limitations.push(`events_invalid:${validated.issues.join(",")}`);
    }
  }

  const externalSources: ExternalSourceEvidence[] = sources.map((s) => ({
    evidenceId: s.evidenceId,
    url: s.url,
    title: s.title,
    excerpt: s.excerpt,
    verified: verifySourceForMatch({ title: s.title, excerpt: s.excerpt }, match),
  }));
  for (const s of externalSources) evidenceIds.push(s.evidenceId);
  const mcp = sanitizeMcpEvidence(mcpEvidence);
  for (const item of mcp) evidenceIds.push(item.evidenceId);

  return {
    sport: "football",
    evidenceIds,
    facts,
    statistics,
    matchEvents,
    sources: externalSources,
    mcp,
    limitations,
  };
}

// ---- Public dispatcher ---------------------------------------------------

export function buildMatchEvidence(
  match: Match,
  sources: FirecrawlSource[],
  mcpEvidence: McpEvidence[] = []
): MatchEvidence {
  if (match.sport === "football") return buildFootballEvidence(match, sources, mcpEvidence);
  return buildTennisEvidence(match, sources, mcpEvidence);
}

const MAX_MCP_EVIDENCE_ITEMS = 4;
const MAX_MCP_CONTENT_CHARS = 6_000;

function sanitizeMcpEvidence(items: McpEvidence[]): McpEvidence[] {
  const seen = new Set<string>();
  const valid: McpEvidence[] = [];
  for (const item of items) {
    if (
      valid.length >= MAX_MCP_EVIDENCE_ITEMS ||
      !item ||
      typeof item.evidenceId !== "string" ||
      !/^mcp-\d+$/.test(item.evidenceId) ||
      seen.has(item.evidenceId) ||
      typeof item.toolName !== "string" ||
      !item.toolName.trim() ||
      typeof item.fetchedAt !== "string" ||
      typeof item.content !== "string" ||
      !item.content.trim()
    ) {
      continue;
    }
    seen.add(item.evidenceId);
    valid.push({
      evidenceId: item.evidenceId,
      toolName: item.toolName.trim().slice(0, 128),
      fetchedAt: item.fetchedAt,
      content: item.content.slice(0, MAX_MCP_CONTENT_CHARS),
    });
  }
  return valid;
}

/** Serialize evidence as a compact JSON block. Used by the report
 *  pipeline under the existing "## Dữ liệu trận đấu" marker so the
 *  prompt stays one document. JSON is preferred over free-form
 *  markdown because the validator can re-parse and check claims. */
export function serializeEvidence(evidence: MatchEvidence): string {
  return JSON.stringify(evidence, null, 2);
}
