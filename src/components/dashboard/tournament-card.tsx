import { useState } from "react";
import { ChevronDown, MapPin, Trophy, Star } from "lucide-react";
import type { Match, Tournament } from "@/types";
import { cn } from "@/lib/utils";
import { TournamentBadge } from "@/components/ui/tournament-badge";
import { MatchRow } from "./match-row";

interface TournamentCardProps {
  tournament: Tournament;
  matches: Match[];
  defaultExpanded?: boolean;
  onOpenReport?: (matchId: string) => void;
  onOpenScheduleModal?: (matchId: string) => void;
}

/**
 * Tournament card redesigned to match the flashscore.com layout.
 *
 * Layout: ⭐ [red icon] [Full name with category prefix + location + surface] ... [Draw] ⌄
 *
 * The full tournament name (e.g. "WTA - SINGLES: Toronto (Canada), hard")
 * is shown as-is from the API — flashscore.com convention. Surface/location/
 * category are also parsed into typed fields for the badge + icon.
 */
export function TournamentCard({
  tournament,
  matches,
  defaultExpanded = true,
  onOpenReport,
  onOpenScheduleModal,
}: TournamentCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const liveCount = matches.filter((m) => m.status === "live").length;
  const completedCount = matches.filter((m) => m.status === "completed").length;
  const scheduledCount = matches.filter((m) => m.status === "scheduled").length;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-800/40">
      <div className="flex w-full items-center gap-3 border-b border-slate-800 px-4 py-3 transition-colors hover:bg-slate-800/60">
        {/* Star (favorite tournament — non-functional placeholder for now) */}
        <button
          type="button"
          className="flex-shrink-0 text-slate-500 transition-colors hover:text-amber-300"
          title="Đánh dấu giải yêu thích"
        >
          <Star className="h-4 w-4" />
        </button>

        {/* Red trophy icon — flashscore-style */}
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-red-400">
          <Trophy className="h-4 w-4 fill-red-400/30" />
        </div>

        {/* Full name + meta */}
        <div className="flex flex-1 flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-100">
              {tournament.name}
            </span>
            <TournamentBadge category={tournament.category} />
          </div>
          {tournament.location && (
            <div className="flex items-center gap-1 text-[11px] text-slate-400">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{tournament.location}</span>
              <SurfaceInline surface={tournament.surface} />
            </div>
          )}
        </div>

        {/* Match counts */}
        <div className="flex items-center gap-2 text-[11px]">
          {liveCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 font-medium text-red-300">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
              {liveCount} live
            </span>
          )}
          {completedCount > 0 && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300">
              {completedCount} xong
            </span>
          )}
          {scheduledCount > 0 && (
            <span className="rounded-full bg-slate-700/60 px-2 py-0.5 font-medium text-slate-300">
              {scheduledCount} sắp
            </span>
          )}
        </div>

        {/* Draw link (placeholder — full tournament bracket not implemented) */}
        <button
          type="button"
          className="flex-shrink-0 text-[11px] text-slate-400 underline-offset-2 transition-colors hover:text-slate-200 hover:underline"
          title="Xem bảng đấu (chưa implement)"
        >
          Draw
        </button>

        {/* Expand/collapse */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-shrink-0 text-slate-400 transition-transform"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
          />
        </button>
      </div>

      {expanded && (
        <div className="fade-in">
          {matches.map((m) => (
            <MatchRow
              key={m.id}
              match={m}
              onOpenReport={onOpenReport}
              onOpenScheduleModal={onOpenScheduleModal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Surface helpers                                                     */
/* ------------------------------------------------------------------ */

function surfaceLabel(s: Tournament["surface"]): string {
  switch (s) {
    case "hard":
      return "Sàn cứng";
    case "clay":
      return "Sàn đất nện";
    case "grass":
      return "Sàn cỏ";
    default:
      return s;
  }
}

function SurfaceInline({ surface }: { surface: Tournament["surface"] }) {
  const color =
    surface === "hard"
      ? "bg-sky-400"
      : surface === "clay"
        ? "bg-orange-400"
        : "bg-emerald-400";
  return (
    <span
      className={cn("ml-2 inline-flex items-center gap-1 text-slate-500")}
      title={surfaceLabel(surface)}
    >
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", color)} />
      <span>·</span>
      <span>{surfaceLabel(surface)}</span>
    </span>
  );
}
