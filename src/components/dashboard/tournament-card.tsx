import { useState } from "react";
import { ChevronDown, MapPin, Trophy } from "lucide-react";
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
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 border-b border-slate-800 px-4 py-3 text-left transition-colors hover:bg-slate-800/60"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-700/60 text-amber-400">
          <Trophy className="h-4 w-4" />
        </div>
        <div className="flex flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">
              {tournament.name}
            </span>
            <TournamentBadge category={tournament.category} />
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="flex items-center gap-0.5">
              <MapPin className="h-3 w-3" />
              {tournament.location}
            </span>
            {tournament.prizeMoney && (
              <>
                <span className="text-slate-600">•</span>
                <span>{tournament.prizeMoney}</span>
              </>
            )}
            <span className="text-slate-600">•</span>
            <span>{tournament.surface === "hard" ? "Sàn cứng" : tournament.surface === "clay" ? "Sàn đất nện" : "Sàn cỏ"}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          {liveCount > 0 && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 font-medium text-red-300">
              🔴 {liveCount} live
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
          <span className="ml-1 text-slate-500">({matches.length} trận)</span>
        </div>

        <ChevronDown
          className={cn(
            "h-4 w-4 text-slate-400 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>

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
