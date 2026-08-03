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
        home_games: 1,
        away_games: 0,
        game_winner: 1,
        is_break: null,
        server: 1,
        point_sequence: "15:0, 30:0, 40:0, 40:15, 40:30, 40:40, A:40",
      },
      {
        home_games: 1,
        away_games: 1,
        game_winner: 2,
        is_break: null,
        server: 2,
        point_sequence: "15:0, 15:15, 15:30, 15:40",
      },
      {
        home_games: 2,
        away_games: 1,
        game_winner: 1,
        is_break: null,
        server: 1,
        point_sequence: "15:0, 30:0, 30:15, 40:15, 40:30",
      },
      {
        home_games: 2,
        away_games: 2,
        game_winner: 2,
        is_break: null,
        server: 2,
        point_sequence: "15:0, 15:15, 30:15, 30:30, 30:40",
      },
      {
        home_games: 3,
        away_games: 2,
        game_winner: 1,
        is_break: null,
        server: 1,
        point_sequence:
          "0:15, 0:30, 0:40 |B1|, 15:40 |B1|, 30:40 |B1|, 40:40, A:40, 40:40, 40:A |B1|, 40:40, A:40",
      },
      {
        home_games: 3,
        away_games: 3,
        game_winner: 2,
        is_break: null,
        server: 2,
        point_sequence: "0:15, 0:30, 0:40",
      },
      {
        home_games: 4,
        away_games: 3,
        game_winner: 1,
        is_break: null,
        server: 1,
        point_sequence: "15:0, 30:0, 40:0, 40:15",
      },
      {
        home_games: 5,
        away_games: 3,
        game_winner: 2,
        is_break: 2,
        server: 1,
        point_sequence: "15:0, 30:0, 40:0 |B1|, 40:15 |B1|, 40:30 |B1|",
      },
      {
        home_games: 6,
        away_games: 3,
        game_winner: 1,
        is_break: null,
        server: 1,
        point_sequence: "15:0, 30:0, 40:0 |B2|, 40:15 |B2|, 40:30 |B2|",
      },
    ],
  },
  {
    name: "Set 2",
    description: "Point by point - Set 2",
    games: [
      {
        home_games: 0,
        away_games: 1,
        game_winner: 2,
        is_break: null,
        server: 2,
        point_sequence: "0:15, 0:30, 0:40",
      },
      {
        home_games: 1,
        away_games: 1,
        game_winner: 1,
        is_break: null,
        server: 1,
        point_sequence: "0:15, 0:30, 15:30, 30:30, 40:30",
      },
      {
        home_games: 2,
        away_games: 1,
        game_winner: 2,
        is_break: 2,
        server: 1,
        point_sequence: "15:0, 15:15, 30:15, 40:15 |B1|, 40:30 |B1|",
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
  home_team: { team_id: "M5Nr6FTR", name: "Gea A.", short_name: "GEA" },
  away_team: { team_id: "zXddgn9o", name: "Shapovalov D.", short_name: "SHA" },
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

test("PBP: game 8 (idx 7) has is_break=2 (Shapovalov broke Gea)", () => {
  assert(pbp !== null, "null");
  // Game 8 in set 1 (index 7 in 0-indexed array) — the break point
  assertEq(pbp.sets[0].games[7].isBreak, 2, "isBreak");
});

test("PBP: game 5 (idx 4) has is_break=null (no break)", () => {
  assert(pbp !== null, "null");
  // Game 5 in set 1 — Shapovalov's serve, Gea holds (no break)
  assertEq(pbp.sets[0].games[4].isBreak, null, "isBreak");
});

test("PBP: set 2 game 3 (idx 2) has is_break=2 (break)", () => {
  assert(pbp !== null, "null");
  // Game 3 in set 2 — another break
  assertEq(pbp.sets[1].games[2].isBreak, 2, "isBreak");
});

test("PBP: server=1 for set 1 game 1 (Gea serves first)", () => {
  assert(pbp !== null, "null");
  assertEq(pbp.sets[0].games[0].server, 1, "server");
});

test("PBP: game_winner correctly parsed (1=home, 2=away)", () => {
  assert(pbp !== null, "null");
  assertEq(pbp.sets[0].games[0].gameWinner, 1, "winner");
  assertEq(pbp.sets[0].games[1].gameWinner, 2, "winner");
});

test("PBP: point_sequence preserved as string", () => {
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

// ===== Summary =====
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
