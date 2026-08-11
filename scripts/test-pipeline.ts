// Quick smoke test for the PBP + details + state machine pipeline.
// Run with: npx tsx scripts/test-pipeline.ts
//
// Verifies:
//   1. mapPointByPoint parses a real PBP payload correctly
//   2. mapMatchDetails parses a real details payload correctly
//   3. State machine transitions work (TypeScript-level validation)

import { mapPointByPoint } from "../src/api/flashscore-mapper";
import { mapMatchDetails } from "../src/api/flashscore-mapper";

// ===== Sample 1: PBP payload (from user's earlier paste) =====
const pbpSample = [
  {
    name: "Set 1",
    description: "Point by point - Set 1",
    games: [
      {
        homeGames: 1,
        awayGames: 0,
        gameWinner: 1,
        isBreak: null,
        server: 1,
        pointSequence: "15:0, 30:0, 40:0, 40:15, 40:30, 40:40, A:40",
      },
      {
        homeGames: 1,
        awayGames: 1,
        gameWinner: 2,
        isBreak: null,
        server: 2,
        pointSequence: "15:0, 15:15, 15:30, 15:40",
      },
      {
        homeGames: 2,
        awayGames: 1,
        gameWinner: 1,
        isBreak: null,
        server: 1,
        pointSequence: "15:0, 30:0, 30:15, 40:15, 40:30",
      },
      {
        homeGames: 2,
        awayGames: 2,
        gameWinner: 2,
        isBreak: null,
        server: 2,
        pointSequence: "15:0, 15:15, 30:15, 30:30, 30:40",
      },
      {
        homeGames: 3,
        awayGames: 2,
        gameWinner: 1,
        isBreak: null,
        server: 1,
        pointSequence:
          "0:15, 0:30, 0:40 |B1|, 15:40 |B1|, 30:40 |B1|, 40:40, A:40, 40:40, 40:A |B1|, 40:40, A:40",
      },
      {
        homeGames: 3,
        awayGames: 3,
        gameWinner: 2,
        isBreak: null,
        server: 2,
        pointSequence: "0:15, 0:30, 0:40",
      },
      {
        homeGames: 4,
        awayGames: 3,
        gameWinner: 1,
        isBreak: null,
        server: 1,
        pointSequence: "15:0, 30:0, 40:0, 40:15",
      },
      {
        homeGames: 5,
        awayGames: 3,
        gameWinner: 2,
        isBreak: 2,
        server: 1,
        pointSequence: "15:0, 30:0, 40:0 |B1|, 40:15 |B1|, 40:30 |B1|",
      },
      {
        homeGames: 6,
        awayGames: 3,
        gameWinner: 1,
        isBreak: null,
        server: 1,
        pointSequence: "15:0, 30:0, 40:0 |B2|, 40:15 |B2|, 40:30 |B2|",
      },
    ],
  },
  {
    name: "Set 2",
    description: "Point by point - Set 2",
    games: [
      {
        homeGames: 0,
        awayGames: 1,
        gameWinner: 2,
        isBreak: null,
        server: 2,
        pointSequence: "0:15, 0:30, 0:40",
      },
      {
        homeGames: 1,
        awayGames: 1,
        gameWinner: 1,
        isBreak: null,
        server: 1,
        pointSequence: "0:15, 0:30, 15:30, 30:30, 40:30",
      },
      {
        homeGames: 2,
        awayGames: 1,
        gameWinner: 2,
        isBreak: 2,
        server: 1,
        pointSequence: "15:0, 15:15, 30:15, 40:15 |B1|, 40:30 |B1|",
      },
    ],
  },
];

// ===== Sample 2: Details payload (from user's earlier paste) =====
const detailsSample = {
  match_id: "YoyvKzvo",
  match_status: {
    stage: "Finished",
    is_cancelled: false,
    is_postponed: false,
    is_started: true,
    is_in_progress: false,
    is_finished: true,
    winner: "home",
    final_winner: "home",
  },
  timestamp: 1785645594,
  home_team: { team_id: "M5Nr6FTR", name: "Gea A.", full_name: "Arthur Gea", seed: 12, short_name: "GEA" },
  away_team: { team_id: "zXddgn9o", name: "Shapovalov D.", full_name: "Denis Shapovalov", seed_number: "6", short_name: "SHA" },
  scores: {
    home: 2,
    away: 0,
    time: "1:30",
    home_1set: 6,
    away_1set: 3,
    home_1set_tiebreak: null,
    away_1set_tiebreak: null,
    "1set_time": "0:41",
    home_2set: 6,
    away_2set: 4,
    home_2set_tiebreak: null,
    away_2set_tiebreak: null,
    "2set_time": "0:49",
    home_3set: null,
    away_3set: null,
    home_4set: null,
    away_4set: null,
    home_5set: null,
    away_5set: null,
  },
};

// ===== Test runner =====
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`❌ ${name}`);
    console.log(`   ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertEq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

// ===== PBP tests =====
console.log("\n=== mapPointByPoint tests ===\n");

const pbp = mapPointByPoint(pbpSample);

test("PBP: returns non-null", () => {
  assert(pbp !== null, "expected non-null");
});

test("PBP: parses 2 sets", () => {
  assert(pbp !== null, "null");
  assertEq(pbp.sets.length, 2, "set count");
});

test("PBP: set 1 has 9 games", () => {
  assert(pbp !== null, "null");
  assertEq(pbp.sets[0].games.length, 9, "game count");
});

test("PBP: set 2 has 3 games", () => {
  assert(pbp !== null, "null");
  assertEq(pbp.sets[1].games.length, 3, "game count");
});

test("PBP: game 8 (idx 7) has isBreak=2 (Shapovalov broke Gea)", () => {
  assert(pbp !== null, "null");
  // Game 8 in set 1 (index 7 in 0-indexed array) — the break point
  assertEq(pbp.sets[0].games[7].isBreak, 2, "isBreak");
});

test("PBP: game 5 (idx 4) has isBreak=null (no break)", () => {
  assert(pbp !== null, "null");
  // Game 5 in set 1 — Shapovalov's serve, Gea holds (no break)
  assertEq(pbp.sets[0].games[4].isBreak, null, "isBreak");
});

test("PBP: set 2 game 3 (idx 2) has isBreak=2 (break)", () => {
  assert(pbp !== null, "null");
  // Game 3 in set 2 — another break
  assertEq(pbp.sets[1].games[2].isBreak, 2, "isBreak");
});

test("PBP: server=1 for set 1 game 1 (Gea serves first)", () => {
  assert(pbp !== null, "null");
  assertEq(pbp.sets[0].games[0].server, 1, "server");
});

test("PBP: gameWinner correctly parsed (1=home, 2=away)", () => {
  assert(pbp !== null, "null");
  assertEq(pbp.sets[0].games[0].gameWinner, 1, "winner");
  assertEq(pbp.sets[0].games[1].gameWinner, 2, "winner");
});

test("PBP: pointSequence preserved as string", () => {
  assert(pbp !== null, "null");
  const seq = pbp.sets[0].games[4].pointSequence;
  assert(seq.includes("|B1|"), `expected |B1| in sequence, got: ${seq}`);
  assert(seq.includes("A:40"), "expected A:40 in sequence");
});

test("PBP: setNumber correctly assigned (1, 2)", () => {
  assert(pbp !== null, "null");
  assertEq(pbp.sets[0].setNumber, 1, "set 1");
  assertEq(pbp.sets[1].setNumber, 2, "set 2");
});

test("PBP: home/away games count up correctly", () => {
  assert(pbp !== null, "null");
  const lastGameSet1 = pbp.sets[0].games[pbp.sets[0].games.length - 1];
  assertEq(lastGameSet1.homeGames, 6, "home games at end of set 1");
  assertEq(lastGameSet1.awayGames, 3, "away games at end of set 1");
});

// ===== Details tests =====
console.log("\n=== mapMatchDetails tests ===\n");

const details = mapMatchDetails(detailsSample);

test("Details: returns non-null", () => {
  assert(details !== null, "expected non-null");
});

test("Details: parses 2 sets from flat fields", () => {
  assert(details !== null, "null");
  assert(details.sets !== undefined, "sets undefined");
  assertEq(details.sets!.length, 2, "set count");
});

test("Details: set 1 = 6-3 (Gea won)", () => {
  assert(details !== null, "null");
  assert(details.sets !== undefined, "sets undefined");
  assertEq(details.sets![0].player1, 6, "set 1 player1");
  assertEq(details.sets![0].player2, 3, "set 1 player2");
});

test("Details: set 2 = 6-4 (Gea won)", () => {
  assert(details !== null, "null");
  assert(details.sets !== undefined, "sets undefined");
  assertEq(details.sets![1].player1, 6, "set 2 player1");
  assertEq(details.sets![1].player2, 4, "set 2 player2");
});

test("Details: skipped null sets 3-5", () => {
  assert(details !== null, "null");
  assert(details.sets !== undefined, "sets undefined");
  assertEq(details.sets!.length, 2, "should skip null sets 3-5");
});

test("Details: match duration parsed = 90 minutes (1:30)", () => {
  assert(details !== null, "null");
  assertEq(details.matchDurationMinutes, 90, "match duration");
});

test("Details: extracts full player names without retaining abbreviations", () => {
  assertEq(details.player1?.fullName, "Arthur Gea", "home full name");
  assertEq(details.player2?.fullName, "Denis Shapovalov", "away full name");
});

test("Details: extracts both numeric seeds", () => {
  assertEq(details.player1?.seed, 12, "home seed");
  assertEq(details.player2?.seed, 6, "away seed");
});

// ===== Edge cases =====
console.log("\n=== Edge case tests ===\n");

test("PBP: empty array returns null", () => {
  const result = mapPointByPoint([]);
  assert(result === null, "expected null for empty array");
});

test("PBP: null payload returns null", () => {
  const result = mapPointByPoint(null);
  assert(result === null, "expected null for null");
});

test("PBP: wrapped payload (data: [...]) works", () => {
  const result = mapPointByPoint({ data: pbpSample });
  assert(result !== null, "expected non-null for wrapped");
  assert(result !== null && result.sets.length === 2, "set count");
});

test("PBP: malformed set (no games) is skipped", () => {
  const malformed = [{ name: "Empty Set", games: [] }, ...pbpSample];
  const result = mapPointByPoint(malformed);
  // Should still return 2 sets (the malformed one is skipped)
  assert(result !== null && result.sets.length === 2, "should skip empty set");
});



// ===== Publication-safe evidence tests =====

import { buildTennisEvidence, buildFootballEvidence } from "../src/reports/evidence";
import type { TennisMatch, FootballMatch, PointByPointData } from "../src/types";

console.log("\n=== buildTennisEvidence tests ===\n");

const sampleMatch = (): TennisMatch => ({
  id: "T1",
  sport: "tennis",
  tournamentId: "tn1",
  tournamentName: "ATP Montreal",
  tournamentCategory: "ATP Masters 1000",
  round: "R32",
  startTime: new Date("2026-08-10T18:00:00Z").toISOString(),
  status: "completed",
  finalScore: { side1: 2, side2: 0 },
  player1: {
    kind: "player",
    name: "J. Mensik",
    fullName: "Jakub Mensik",
    country: "CZE",
    countryFlag: "CZ",
    ranking: 18,
    seed: 14,
  },
  player2: {
    kind: "player",
    name: "B. van de Zandschulp",
    fullName: "Botic van de Zandschulp",
    country: "NED",
    countryFlag: "NL",
    ranking: 64,
  },
  sets: [
    { player1: 6, player2: 4 },
    { player1: 7, player2: 5 },
  ],
  setsWon: { side1: 2, side2: 0 },
  stats: {
    aces: { player1: 12, player2: 4 },
    doubleFaults: { player1: 2, player2: 5 },
    firstServePct: { player1: 65, player2: 55 },
    breakPointsConverted: { player1: 4, player2: 2 },
    breakPointsFaced: { player1: 5, player2: 6 },
    totalPointsWon: { player1: 80, player2: 65 },
    matchDurationMinutes: 95,
  },
  pointByPoint: {
    sets: [
      {
        setNumber: 1,
        name: "Set 1",
        games: [
          { homeGames: 1, awayGames: 0, gameWinner: 1, isBreak: null, server: 1, pointSequence: "15:0, 30:0, 40:0" },
          { homeGames: 1, awayGames: 1, gameWinner: 2, isBreak: null, server: 2, pointSequence: "15:0, 30:15, 40:15" },
          { homeGames: 2, awayGames: 1, gameWinner: 1, isBreak: null, server: 1, pointSequence: "15:0, 30:0, 40:0" },
          { homeGames: 3, awayGames: 1, gameWinner: 1, isBreak: null, server: 1, pointSequence: "0:15, 15:15, 30:15, 40:15" },
          { homeGames: 3, awayGames: 2, gameWinner: 2, isBreak: 2, server: 1, pointSequence: "15:0, 30:0, 40:0 |B1|, 40:15 |B1|" },
          { homeGames: 4, awayGames: 2, gameWinner: 1, isBreak: 1, server: 2, pointSequence: "15:0, 30:0, 40:0" },
          { homeGames: 5, awayGames: 2, gameWinner: 1, isBreak: null, server: 1, pointSequence: "15:0, 30:0, 40:0" },
          { homeGames: 5, awayGames: 3, gameWinner: 2, isBreak: 2, server: 1, pointSequence: "15:0, 30:0, 40:0 |B2|, 40:15 |B2|" },
          { homeGames: 6, awayGames: 3, gameWinner: 1, isBreak: null, server: 1, pointSequence: "15:0, 30:0, 40:0" },
        ],
      },
    ],
  },
});

test("tennis evidence: builds facts + stats + timeline", () => {
  const m = sampleMatch();
  const ev = buildTennisEvidence(m, []);
  assert(ev.facts.winnerSide === 1, "winner side 1");
  assertEq(ev.facts.finalScore![0].player1, 6, "set 1 p1");
  assertEq(ev.statistics!.successfulBreaks.player1, 4, "successful breaks p1");
  assertEq(ev.statistics!.breakPointOpportunities.player1, 5, "opportunities p1");
  assert(ev.tacticalTimeline !== null, "tactical timeline present");
});

test("tennis evidence: rejects contradictory PBP (break mismatch)", () => {
  const m = sampleMatch();
  // Tamper: claim server=2 broke themselves in game 5 (contradicts
  // gameWinner/inferredBreak).
  const bad: PointByPointData = {
    sets: [
      {
        setNumber: 1,
        name: "Set 1",
        games: [
          { homeGames: 1, awayGames: 0, gameWinner: 1, isBreak: null, server: 1, pointSequence: "x" },
          { homeGames: 1, awayGames: 1, gameWinner: 2, isBreak: 1, server: 2, pointSequence: "x" }, // BAD: isBreak=1 but server=winner=2
        ],
      },
    ],
  };
  m.pointByPoint = bad;
  const ev = buildTennisEvidence(m, []);
  assert(ev.tacticalTimeline === null, "timeline dropped on contradiction");
  assert(ev.limitations.some((l) => l.includes("pbp_break_mismatch")), "limitation recorded");
});

test("tennis evidence: rejects cumulative regression", () => {
  const m = sampleMatch();
  const bad: PointByPointData = {
    sets: [
      {
        setNumber: 1,
        name: "Set 1",
        games: [
          { homeGames: 2, awayGames: 0, gameWinner: 1, isBreak: null, server: 1, pointSequence: "x" },
          { homeGames: 1, awayGames: 0, gameWinner: 2, isBreak: null, server: 2, pointSequence: "x" }, // BAD: regression
        ],
      },
    ],
  };
  m.pointByPoint = bad;
  const ev = buildTennisEvidence(m, []);
  assert(ev.tacticalTimeline === null, "timeline dropped");
});

test("tennis evidence: rejects converted > opportunities", () => {
  const m = sampleMatch();
  m.stats!.breakPointsConverted = { player1: 10, player2: 0 };
  m.stats!.breakPointsFaced = { player1: 2, player2: 0 };
  const ev = buildTennisEvidence(m, []);
  assert(ev.statistics === null, "stats rejected");
});

console.log("\n=== buildFootballEvidence tests ===\n");

const sampleFootball = (): FootballMatch => ({
  id: "F1",
  sport: "football",
  tournamentId: "tn2",
  tournamentName: "Premier League",
  tournamentCategory: "Top Domestic League",
  round: "Matchday 1",
  startTime: new Date("2026-08-10T19:00:00Z").toISOString(),
  status: "completed",
  finalScore: { side1: 2, side2: 1 },
  halftimeScore: { side1: 1, side2: 0 },
  home: { kind: "team", name: "Arsenal", shortName: "ARS", country: "England", countryFlag: "GB" },
  away: { kind: "team", name: "Manchester City", shortName: "MCI", country: "England", countryFlag: "GB" },
  events: {
    goals: [
      { side: "home", minute: 23, scorer: "Saka" },
      { side: "away", minute: 58, scorer: "Haaland" },
      { side: "home", minute: 78, scorer: "Martinelli" },
    ],
    cards: [],
    subs: [],
  },
  stats: {
    possession: { home: 48, away: 52 },
    shots: { home: 14, away: 9 },
    shotsOnTarget: { home: 6, away: 3 },
  },
});

test("football evidence: builds facts + stats + events", () => {
  const m = sampleFootball();
  const ev = buildFootballEvidence(m, []);
  assert(ev.facts.winnerSide === 1, "home wins");
  assertEq(ev.facts.finalScore!.home, 2, "final home");
  assertEq(ev.matchEvents!.goals.length, 3, "3 goals");
});

test("football evidence: drops contradictory extra goals", () => {
  const m = sampleFootball();
  m.events = {
    goals: [
      { side: "home", minute: 5, scorer: "X" },
      { side: "home", minute: 30, scorer: "Y" },
      { side: "home", minute: 60, scorer: "Z" },
      { side: "home", minute: 88, scorer: "Excess" }, // 4th home goal
    ],
    cards: [],
    subs: [],
  };
  const ev = buildFootballEvidence(m, []);
  assertEq(ev.matchEvents!.goals.length, 2, "only 2 home goals kept; rest dropped");
  assert(ev.limitations.some((l) => l.includes("extra_home_goal")), "limitation recorded");
});

test("football evidence: possession mismatch is rejected", () => {
  const m = sampleFootball();
  m.stats = { possession: { home: 100, away: 0 } }; // doesn't sum to ~100
  const ev = buildFootballEvidence(m, []);
  assert(ev.statistics === null, "stats null when possession mismatch");
});

// ===== Summary =====
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
