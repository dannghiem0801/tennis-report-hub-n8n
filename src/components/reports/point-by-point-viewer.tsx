/**
 * Point-by-point viewer for the final report dialog.
 *
 * Renders the match's `pointByPoint` data (from FlashScore's
 * /matches/match/point-by-point endpoint) as a tabbed UI, one tab
 * per set, with per-game breakdown styled after flashscore.com:
 *
 *   - Server icon (circle) on the side of the server
 *   - "LOST SERVE" badge on the side of the player who got broken
 *   - Game score: winning number in white bold, losing number in red
 *   - Point sequence with markers: |B1|/|B2| (break point), |SP| (set point), |MP| (match point)
 *   - Final set ends with a "FINISHED N-M" banner showing the sets won
 *
 * Only renders if `match.pointByPoint` is populated (i.e. the user
 * added this match to the watchlist — PBP is fetched lazily there).
 */

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Match, PointByPointData, PointByPointGame, PointByPointSet, TennisMatch } from "@/types";

export function PointByPointViewer({ match }: { match: Match }) {
  const pbp: PointByPointData | undefined = (match as TennisMatch).pointByPoint;
  if (!pbp || pbp.sets.length === 0) return null;

  return (
    <section className="mt-6 border-t border-slate-800 pt-5">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Point-by-point
        </h3>
        <span className="text-[10px] text-slate-500">
          ({pbp.sets.length} set{pbp.sets.length === 1 ? "" : "s"} · từ FlashScore API)
        </span>
      </div>

      <Tabs defaultValue="set-0" className="w-full">
        <TabsList className="w-full justify-start gap-0 rounded-b-none border-b border-slate-800 bg-transparent p-0">
          {pbp.sets.map((set: PointByPointSet, i: number) => (
            <TabsTrigger
              key={i}
              value={`set-${i}`}
              className="rounded-b-none border-b-2 border-transparent data-[state=active]:border-slate-200 data-[state=active]:bg-transparent data-[state=active]:text-slate-100 data-[state=inactive]:text-slate-400"
            >
              SET {set.setNumber}
            </TabsTrigger>
          ))}
        </TabsList>

        {pbp.sets.map((set: PointByPointSet, i: number) => (
          <TabsContent key={i} value={`set-${i}`} className="mt-0">
            <SetView
              set={set}
              match={match}
              isLastSet={i === pbp.sets.length - 1}
            />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Single set                                                         */
/* ------------------------------------------------------------------ */

function SetView({
  set,
  match,
  isLastSet,
}: {
  set: PointByPointSet;
  match: Match;
  isLastSet: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/40">
      <div className="border-b border-slate-800 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-slate-400">
        Point by point - Set {set.setNumber}
      </div>

      <div>
        {set.games.map((game: any, i: number) => (
          <GameRow key={i} game={game} setNumber={set.setNumber} />
        ))}
      </div>

      {isLastSet && <FinalBanner match={match} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Single game row                                                    */
/* ------------------------------------------------------------------ */

function GameRow({ game, setNumber }: { game: PointByPointGame; setNumber: number }) {
  const server = game.server; // 1 = home, 2 = away
  const winner = game.gameWinner; // 1 = home, 2 = away
  // flashscore.com PBP convention: the "LOST SERVE" badge sits on the
  // side of the BREAKER (the player who won the game by breaking
  // serve), NOT on the server who got broken. It's a positive
  // achievement marker for the receiver, paired visually with the
  // tennis-ball server icon on the opposite side.
  //
  // isBreak per type: 1 = p1 broke p2, 2 = p2 broke p1.
  //   isBreak=1 → home (p1) is the breaker → badge on LEFT
  //   isBreak=2 → away (p2) is the breaker → badge on RIGHT
  const homeLostServe = game.isBreak === 1;
  const awayLostServe = game.isBreak === 2;
  const isSetPoint = isSetOrMatchPoint(game, setNumber);

  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-slate-800/60 px-3 py-3 last:border-b-0",
        isSetPoint && "bg-slate-900/40"
      )}
    >
      {/* LEFT: home side.
          Order inside the flex (justify-end, so first = leftmost):
            1. LOST SERVE badge (outer edge, far from the score)
            2. Server icon (closer to the score)
          This mirrors flashscore.com: badge on the outer edge, ball
          between the badge and the score. */}
      <div className="flex items-center justify-end gap-2">
        {homeLostServe && <LostServeBadge />}
        {server === 1 && <ServerIcon />}
      </div>

      {/* CENTER: score + point sequence.
          flashscore.com convention (verified from real PBP samples):
          - WINNING number (the one that just changed) → white BOLD
          - LOSING number (the one that didn't change) → red (muted) */}
      <div className="flex min-w-0 flex-col items-center gap-1.5">
        <div className="font-mono text-base leading-none">
          <span className={cn(winner === 1 ? "font-bold text-slate-100" : "text-red-400")}>
            {game.homeGames}
          </span>
          <span className="mx-1.5 text-slate-500">-</span>
          <span className={cn(winner === 2 ? "font-bold text-slate-100" : "text-red-400")}>
            {game.awayGames}
          </span>
        </div>
        <PointSequence seq={game.pointSequence} />
      </div>

      {/* RIGHT: away side.
          Order inside the flex (justify-start, so first = leftmost =
          closest to the score):
            1. Server icon (closer to the score)
            2. LOST SERVE badge (outer edge, far from the score)
          Mirror of the LEFT column. */}
      <div className="flex items-center justify-start gap-2">
        {server === 2 && <ServerIcon />}
        {awayLostServe && <LostServeBadge />}
      </div>
    </div>
  );
}

/**
 * Heuristic: the last game of the set is the set point (and possibly
 * match point) if and only if the cumulative score makes sense
 * (winner leads by ≥2 with 6+ games, or 7-6 in tiebreak). We don't
 * have explicit set/match point flags in the data, so we infer it.
 */
function isSetOrMatchPoint(game: PointByPointGame, _setNumber: number): boolean {
  const a = game.homeGames;
  const b = game.awayGames;
  // Last game of the set is identifiable by either: score = 6 (set closed)
  // or score = 7 (tiebreak). The "set point" highlight is purely cosmetic;
  // we just want to subtly emphasize the deciding game.
  return a >= 6 || b >= 6;
}

/* ------------------------------------------------------------------ */
/*  Server icon (tennis ball)                                          */
/* ------------------------------------------------------------------ */

function ServerIcon() {
  // Plain outlined circle matches the flashscore.com server icon.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-slate-300"
      aria-label="Server"
    >
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function LostServeBadge() {
  return (
    <span className="inline-flex items-center rounded border border-red-500 bg-red-500 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white">
      Lost serve
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Point sequence with markers                                        */
/* ------------------------------------------------------------------ */

/**
 * Parse a point_sequence string like
 *   "15:0, 30:0, 40:0, 40:15 |B1|, 40:30 |B1|, 40:40, A:40, 40:40, A:40 |MP|"
 * into segments with marker annotations.
 *
 * Markers in the source data:
 *   |B1|, |B2|, |B3| — break point (1st, 2nd, 3rd)
 *   |SP|              — set point
 *   |MP|              — match point
 *
 * We strip the marker into a flag for styling, but the score stays inline.
 */
type SeqSegment = { text: string; marker: "BP" | "SP" | "MP" | null };

function parsePointSequence(raw: string): SeqSegment[] {
  if (!raw) return [];
  // Split on commas; each segment may carry a |...| marker at the end.
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  // Marker shape: |BP|, |B1|, |B2|, |SP|, |MP|.
  // Note: `B[0-9]*` (not `+`) — without that, the regex tries to match
  // a digit after `B` and bails out on plain "|BP|" because the next
  // char is the closing `|`, not a digit.
  const MARKER_RE = /\|\s*(BP|B[0-9]*|SP|MP)\s*\|/i;
  return parts.map<SeqSegment>((part) => {
    const m = part.match(MARKER_RE);
    if (!m) return { text: part, marker: null };
    const tag = m[1].toUpperCase();
    const text = part.replace(MARKER_RE, "").trim();
    if (tag === "SP") return { text, marker: "SP" };
    if (tag === "MP") return { text, marker: "MP" };
    return { text, marker: "BP" };
  });
}

function PointSequence({ seq }: { seq: string }) {
  const segments = parsePointSequence(seq);
  if (segments.length === 0) return null;
  return (
    <div className="flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-1 font-mono text-[10.5px] text-slate-400">
      {segments.map((seg: any, i: number) => (
        <React.Fragment key={i}>
          <span>{seg.text}</span>
          {seg.marker && (
            <span
              className={cn(
                "rounded px-1 text-[9px] font-bold uppercase leading-tight",
                seg.marker === "BP" && "bg-slate-700 text-slate-200",
                seg.marker === "SP" && "bg-blue-500/30 text-blue-200",
                seg.marker === "MP" && "bg-red-500/30 text-red-200"
              )}
            >
              {seg.marker}
            </span>
          )}
          {i < segments.length - 1 && (
            <span className="text-slate-600">·</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Final banner (sets won, shown at end of last set)                  */
/* ------------------------------------------------------------------ */

function FinalBanner({ match }: { match: TennisMatch }) {
  // use destructuring to access side1/side2
  const { side1: setsWonSide1, side2: setsWonSide2 } = (match as TennisMatch).setsWon || {};
  const p1Sets: number = setsWonSide1 ?? 0;
  const p2Sets: number = setsWonSide2 ?? 0;
  const p1Initial = ((match as TennisMatch).player1.fullName || "?").trim().charAt(0).toUpperCase() || "?";
  const p2Initial = ((match as TennisMatch).player2.fullName || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex items-center justify-center gap-6 border-t border-slate-800 bg-slate-900/30 px-4 py-5">
      <PlayerAvatar initial={p1Initial} flag={(match as TennisMatch).player1.countryFlag} side="left" />
      <div className="flex flex-col items-center">
        <div className="font-mono text-3xl font-bold leading-none text-slate-100">
          {p1Sets}-{p2Sets}
        </div>
        <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          Finished
        </div>
      </div>
      <PlayerAvatar initial={p2Initial} flag={(match as TennisMatch).player2.countryFlag} side="right" />
    </div>
  );
}

function PlayerAvatar({
  initial,
  flag,
  side,
}: {
  initial: string;
  flag: string;
  side: "left" | "right";
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-base font-semibold text-slate-200",
          side === "left" ? "rounded-bl-none" : "rounded-br-none"
        )}
        aria-hidden="true"
      >
        {initial}
      </div>
      <div className="text-base leading-none">{flag}</div>
    </div>
  );
}

/* Re-export for tests / convenience. */
export { parsePointSequence };
export type { PointByPointData };
