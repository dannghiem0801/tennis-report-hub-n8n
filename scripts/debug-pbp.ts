import { mapPointByPoint } from "../src/api/flashscore-mapper";

const pbpSample = [
  {
    name: "Set 1",
    description: "Point by point - Set 1",
    games: [
      { home_games: 3, away_games: 2, game_winner: 1, is_break: null, server: 1, point_sequence: "x" },
      { home_games: 3, away_games: 3, game_winner: 2, is_break: null, server: 2, point_sequence: "x" },
      { home_games: 4, away_games: 3, game_winner: 1, is_break: null, server: 1, point_sequence: "x" },
      { home_games: 5, away_games: 3, game_winner: 2, is_break: 2, server: 1, point_sequence: "x" },
      { home_games: 6, away_games: 3, game_winner: 1, is_break: null, server: 1, point_sequence: "x" },
    ],
  },
];

const result = mapPointByPoint(pbpSample);
console.log("set 1 game 4 (idx 3, the break):", JSON.stringify(result?.sets[0].games[3]));
console.log("set 1 game 3 (idx 2, null):", JSON.stringify(result?.sets[0].games[2]));
