import { Star, FileText, Clock } from "lucide-react";
import type { Match, SetScore } from "@/types";
import { Button } from "@/components/ui/button";
import { cn, formatTime } from "@/lib/utils";
import { SCHEDULE_FEATURE_ENABLED } from "@/lib/feature-flags";
import { useApp } from "@/store/app-store";

interface MatchRowProps {
  match: Match;
  compact?: boolean;
  onOpenReport?: (matchId: string) => void;
  onOpenScheduleModal?: (matchId: string) => void;
  className?: string;
}

/**
 * Match row redesigned to match the flashscore.com layout the user requested.
 *
 * Layout (left → right):
 *   [⭐] | [Time/Status] | [Player 1 + score] | [Status badge]
 *        |              | [Player 2 + score] |
 *
 * Score column shows: sets won (bold) + per-set game scores as columns.
 * Tiebreak sets get a small superscript number ("6⁴" = 6 games, lost
 * tiebreak 4-7). Live matches add a final "current set" column.
 * Scheduled matches show no score, just a "PREVIEW" badge on the right.
 */
export function MatchRow({ match, compact: _compact, onOpenReport, onOpenScheduleModal, className }: MatchRowProps) {
  const { isWatchlisted, toggleWatchlist, addToWatchlist, getReportByMatch, watchlist } = useApp();
  const watched = isWatchlisted(match.id);
  const report = getReportByMatch(match.id);
  const entry = watchlist.find((e) => e.matchApiId === match.id);
  const inBatch = !!entry?.batchId;

  const handleScheduleClick = () => {
    if (!watched) addToWatchlist(match);
    onOpenScheduleModal?.(match.id);
  };

  // Winner: most sets won
  const sets = match.sets || [];
  const p1SetsWon = match.setsWon?.player1 ?? sets.filter((s) => s.player1 > s.player2).length;
  const p2SetsWon = match.setsWon?.player2 ?? sets.filter((s) => s.player2 > s.player1).length;
  const p1Won = match.status === "completed" && p1SetsWon > p2SetsWon;
  const p2Won = match.status === "completed" && p2SetsWon > p1SetsWon;
  const isLive = match.status === "live";
  const isCompleted = match.status === "completed";
  const isScheduled = match.status === "scheduled";

  return (
    <div
      className={cn(
        "group grid items-center gap-3 border-b border-slate-800/60 px-3 py-2 last:border-b-0 transition-colors",
        "grid-cols-[20px_60px_1fr_auto] hover:bg-slate-800/30",
        className
      )}
    >
      {/* Star (watchlist) — far left */}
      <div className="flex items-center justify-center">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => toggleWatchlist(match)}
          title={watched ? "Bỏ theo dõi" : "Theo dõi"}
          className={cn("h-6 w-6 p-0", watched ? "text-amber-400 hover:text-amber-300" : "text-slate-500 hover:text-slate-200")}
        >
          <Star className={cn("h-4 w-4", watched && "fill-amber-400 text-amber-400")} />
        </Button>
      </div>

      {/* Time / status word */}
      <div className="flex flex-col items-start text-[11px] leading-tight">
        {isScheduled ? (
          <>
            <span className="font-mono text-slate-200">
              {formatTime(new Date(match.startTime))}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {match.round || "—"}
            </span>
          </>
        ) : (
          <>
            <span
              className={cn(
                "font-medium uppercase tracking-wide",
                isLive ? "text-red-300" : "text-slate-400"
              )}
            >
              {isLive ? "Live" : isCompleted ? "Finished" : "—"}
            </span>
            <span className="text-[10px] text-slate-500">
              {match.round || "—"}
            </span>
          </>
        )}
      </div>

      {/* Players + score */}
      <div className="flex flex-col gap-1 min-w-0">
        <PlayerScoreRow
          flag={match.player1.countryFlag}
          country={match.player1.country}
          name={match.player1.fullName || match.player1.name}
          rank={match.player1.ranking}
          seed={match.player1.seed}
          setsWon={p1SetsWon}
          sets={sets}
          isLive={isLive}
          isPlayer1={true}
          isWinner={p1Won}
          currentSetScore={match.currentSetScore}
        />
        <PlayerScoreRow
          flag={match.player2.countryFlag}
          country={match.player2.country}
          name={match.player2.fullName || match.player2.name}
          rank={match.player2.ranking}
          seed={match.player2.seed}
          setsWon={p2SetsWon}
          sets={sets}
          isLive={isLive}
          isPlayer1={false}
          isWinner={p2Won}
          currentSetScore={match.currentSetScore}
        />
      </div>

      {/* Status badge (PREVIEW for scheduled) / Report button (completed) / Schedule button (live) */}
      <div className="flex items-center gap-1">
        {report ? (
          <Button
            size="sm"
            variant="success"
            onClick={() => onOpenReport?.(match.id)}
            className="h-7 px-2"
            title="Đọc báo cáo"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Đọc</span>
          </Button>
        ) : isScheduled ? (
          <>
            {SCHEDULE_FEATURE_ENABLED && (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={handleScheduleClick}
                title={
                  inBatch
                    ? "Đã trong 1 batch hẹn giờ"
                    : watched
                      ? "Hẹn giờ viết báo cáo cho trận này"
                      : "Thêm vào watchlist + hẹn giờ"
                }
                className={cn(
                  "h-6 w-6 p-0",
                  inBatch
                    ? "text-blue-400 hover:text-blue-300"
                    : "text-slate-500 hover:text-slate-200"
                )}
              >
                <Clock className="h-4 w-4" />
              </Button>
            )}
            <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
              PREVIEW
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function PlayerScoreRow({
  flag,
  country,
  name,
  rank,
  seed,
  setsWon,
  sets,
  isLive,
  isPlayer1,
  isWinner,
  currentSetScore,
}: {
  flag: string;
  country: string;
  name: string;
  rank?: number;
  seed?: number;
  setsWon: number;
  sets: SetScore[];
  isLive: boolean;
  isPlayer1: boolean;
  isWinner: boolean;
  currentSetScore?: { player1: number | string; player2: number | string };
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 truncate text-[13px]",
        isWinner ? "font-bold text-slate-50" : "text-slate-300"
      )}
      title={country ? `${name} (${country})` : name}
    >
      {/* Country flag */}
      <span className="inline-flex h-4 w-5 flex-shrink-0 items-center justify-center text-base leading-none">
        {flag && flag !== "🏳️" ? flag : <span className="block h-2 w-3 rounded-sm bg-slate-700" />}
      </span>

      {/* Name + (seed/rank) */}
      <span className="flex items-center gap-1.5 truncate min-w-0">
        <span className="truncate">{name || "TBD"}</span>
        {seed && (
          <span className="flex-shrink-0 rounded bg-slate-700/70 px-1.5 py-px text-[9px] font-medium tabular-nums text-slate-300">
            ({seed})
          </span>
        )}
        {!seed && rank && rank <= 20 && (
          <span className="flex-shrink-0 text-[10px] tabular-nums text-slate-500">#{rank}</span>
        )}
      </span>

      {/* Live ball icon for the in-progress player */}
      {isLive && currentSetScore && (
        <span className="flex-shrink-0 text-red-400" title="Đang thi đấu">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <path d="M8 1.5 C 5 4, 5 12, 8 14.5 C 11 12, 11 4, 8 1.5" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        </span>
      )}

      {/* Score columns (right-aligned via ml-auto) */}
      <div className="ml-auto flex items-center gap-2.5 flex-shrink-0 tabular-nums">
        {/* Sets won (bold) */}
        <span className="min-w-[1ch] text-right text-[12px]">
          {isLive && setsWon === 0 ? "0" : setsWon}
        </span>
        {/* Per-set games */}
        {sets.length > 0 ? (
          sets.map((s, i) => (
            <SetGameCell
              key={i}
              game={isPlayer1 ? s.player1 : s.player2}
              tb={s.tiebreak ? (isPlayer1 ? s.tiebreak.player1 : s.tiebreak.player2) : undefined}
              opponentGame={isPlayer1 ? s.player2 : s.player1}
              isPlayer1={isPlayer1}
              isWinner={isWinner}
            />
          ))
        ) : (
          <span className="text-[10px] text-slate-600" title="Per-set data requires /matches/details endpoint">
            — — —
          </span>
        )}
        {/* Live: current set (last column, tennis ball style) */}
        {isLive && currentSetScore && (
          <CurrentSetCell
            game={isPlayer1 ? Number(currentSetScore.player1) : Number(currentSetScore.player2)}
          />
        )}
      </div>
    </div>
  );
}

function SetGameCell({
  game,
  tb,
  opponentGame,
  isPlayer1: _isPlayer1,
  isWinner: _isWinner,
}: {
  game: number;
  tb?: number;
  opponentGame: number;
  isPlayer1: boolean;
  isWinner: boolean;
}) {
  // Tiebreak notation: "6⁴" = this player got 6 games, lost tiebreak 4-7
  // (4 superscript = their tiebreak score; opponent has 7 in their row).
  // "7⁵" = won tiebreak 7-5 (5 superscript = their tiebreak score).
  const showTiebreak = tb !== undefined && tb > 0;
  const opponentHas7 = opponentGame === 7;
  const thisHas6 = game === 6;
  // Only show tiebreak superscript on 6-6 / 7-6 / 6-7 sets (not on
  // regular 6-3, 6-4, etc. — those have no tiebreak)
  const shouldRenderTiebreak = showTiebreak && (thisHas6 || game === 7) && (opponentHas7 || thisHas6 && opponentGame === 6);

  return (
    <span className="relative text-[12px]">
      {game}
      {shouldRenderTiebreak && (
        <sup className="ml-0.5 text-[9px] font-medium text-slate-400">{tb}</sup>
      )}
    </span>
  );
}

function CurrentSetCell({ game }: { game: number }) {
  if (Number.isNaN(game)) {
    return <span className="text-[12px]">0</span>;
  }
  return <span className="text-[12px]">{game}</span>;
}
