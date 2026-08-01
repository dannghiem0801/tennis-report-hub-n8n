import { Star, FileText, Clock } from "lucide-react";
import type { Match } from "@/types";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
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

export function MatchRow({ match, compact, onOpenReport, onOpenScheduleModal, className }: MatchRowProps) {
  const { isWatchlisted, toggleWatchlist, addToWatchlist, getReportByMatch, watchlist } = useApp();
  const watched = isWatchlisted(match.id);
  const report = getReportByMatch(match.id);
  const entry = watchlist.find((e) => e.matchApiId === match.id);
  const inBatch = !!entry?.batchId;
  const startTime = new Date(match.startTime);

  // 🕐 click: ensure the match is in the watchlist, then open the
  // schedule modal pre-selected. The modal itself only shows
  // watchlist entries, so the auto-add guarantees the match appears
  // in the selection. If the user prefers the explicit "⭐ first"
  // flow, that still works — ⭐ adds, then 🕐 opens.
  const handleScheduleClick = () => {
    if (!watched) addToWatchlist(match);
    onOpenScheduleModal?.(match.id);
  };

  const sets = match.sets || [];
  const p1Won =
    match.status === "completed" &&
    sets.filter((s) => s.player1 > s.player2).length >
      sets.filter((s) => s.player2 > s.player1).length;
  const p2Won =
    match.status === "completed" &&
    sets.filter((s) => s.player2 > s.player1).length >
      sets.filter((s) => s.player1 > s.player2).length;

  return (
    <div
      className={cn(
        "group grid items-center gap-2 border-b border-slate-800/60 px-3 py-2 last:border-b-0 transition-colors hover:bg-slate-800/30",
        compact ? "grid-cols-[44px_1fr_auto_auto_auto]" : "grid-cols-[56px_1fr_120px_auto_auto_36px]",
        className
      )}
    >
      {/* Time */}
      <div className="flex flex-col items-start text-[11px] leading-tight text-slate-400">
        <span className={cn("font-mono text-slate-200", compact ? "text-[11px]" : "text-xs")}>
          {formatTime(startTime)}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {match.round}
        </span>
      </div>

      {/* Players */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <PlayerLine
          flag={match.player1.countryFlag}
          name={match.player1.name}
          fullName={match.player1.fullName}
          rank={match.player1.ranking}
          seed={match.player1.seed}
          won={p1Won}
        />
        <PlayerLine
          flag={match.player2.countryFlag}
          name={match.player2.name}
          fullName={match.player2.fullName}
          rank={match.player2.ranking}
          seed={match.player2.seed}
          won={p2Won}
        />
      </div>

      {/* Score */}
      <div
        className={cn(
          "flex flex-col items-end gap-0.5 text-xs",
          compact ? "min-w-[80px]" : "min-w-[120px]"
        )}
      >
        {match.status === "completed" ? (
          <>
            {sets[0] && <ScoreLine score={sets[0]} />}
            {sets.length > 1 && (
              <ScoreLine score={sets[sets.length - 1]} dim={!p1Won && !p2Won} />
            )}
            {sets.length > 2 && (
              <span className="text-[10px] text-slate-500">
                {sets.length} set
              </span>
            )}
          </>
        ) : match.status === "live" ? (
          <>
            {sets.map((s, i) => (
              <ScoreLine key={i} score={s} />
            ))}
            {match.currentSetScore && (
              <span className="font-mono text-[11px] text-red-300">
                {match.currentSetScore.player1}-{match.currentSetScore.player2}
              </span>
            )}
          </>
        ) : (
          <span className="text-[11px] text-slate-500">{match.court || "—"}</span>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center justify-end">
        <StatusBadge status={match.status} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {report ? (
          <Button
            size="sm"
            variant="success"
            onClick={() => onOpenReport?.(match.id)}
            className="h-7 px-2"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Đọc</span>
          </Button>
        ) : (
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
                  inBatch
                    ? "text-blue-400 hover:text-blue-300"
                    : "text-slate-500 hover:text-slate-200"
                )}
              >
                <Clock className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="icon-sm"
              variant={watched ? "default" : "ghost"}
              onClick={() => toggleWatchlist(match)}
              title={watched ? "Bỏ theo dõi" : "Theo dõi"}
              className={cn(watched && "text-amber-400 hover:text-amber-300")}
            >
              <Star className={cn("h-4 w-4", watched && "fill-amber-400 text-amber-400")} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function PlayerLine({
  flag,
  name,
  fullName,
  rank,
  seed,
  won,
}: {
  flag: string;
  name: string;
  fullName: string;
  rank?: number;
  seed?: number;
  won: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 truncate text-[13px]",
        won ? "font-semibold text-slate-100" : "text-slate-300"
      )}
      title={fullName}
    >
      <span className="text-sm leading-none">{flag}</span>
      <span className="truncate">{name}</span>
      {seed && (
        <span className="rounded bg-slate-700/60 px-1 text-[9px] font-medium text-slate-300">
          ({seed})
        </span>
      )}
      {!seed && rank && rank <= 20 && (
        <span className="text-[10px] text-slate-500">#{rank}</span>
      )}
    </div>
  );
}

function ScoreLine({
  score,
  dim,
}: {
  score: { player1: number; player2: number; tiebreak?: { player1: number; player2: number } };
  dim?: boolean;
}) {
  const tb = score.tiebreak ? `(${score.tiebreak.player1}-${score.tiebreak.player2})` : "";
  return (
    <span
      className={cn(
        "font-mono text-[12px]",
        dim ? "text-slate-500" : "text-slate-200"
      )}
    >
      {score.player1}-{score.player2}
      {tb}
    </span>
  );
}
