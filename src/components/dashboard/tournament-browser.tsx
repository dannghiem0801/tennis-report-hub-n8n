import { useMemo, useState } from "react";
import { useApp } from "@/store/app-store";
import { TournamentCard } from "./tournament-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Tournament } from "@/types";
import { AlertCircle, Inbox, Globe2, Calendar, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateVi, formatTime, parseDateKey } from "@/lib/utils";

interface TournamentBrowserProps {
  onOpenReport?: (matchId: string) => void;
  onOpenScheduleModal?: (matchId: string) => void;
}

export function TournamentBrowser({ onOpenReport, onOpenScheduleModal }: TournamentBrowserProps) {
  const {
    matches,
    tournaments,
    isFetchingMatches,
    matchError,
    refreshMatches,
    isUsingLiveData,
    selectedDate,
    lastFetchedAt,
    findNearbyDateWithMatches,
  } = useApp();
  const [isSearching, setIsSearching] = useState(false);

  // Live tournaments only — no sample fallback
  const tournamentLookup: Tournament[] = tournaments;

  const groups = useMemo(() => {
    const byTournament = new Map<string, typeof matches>();
    for (const m of matches) {
      const arr = byTournament.get(m.tournamentId) || [];
      arr.push(m);
      byTournament.set(m.tournamentId, arr);
    }
    return Array.from(byTournament.entries()).map(([tid, ms]) => {
      const t = tournamentLookup.find((x) => x.id === tid);
      if (!t) return null;
      // Sort: live first, then scheduled by time, then completed
      const order = { live: 0, scheduled: 1, completed: 2 } as const;
      const sorted = [...ms].sort((a, b) => {
        const oa = order[a.status];
        const ob = order[b.status];
        if (oa !== ob) return oa - ob;
        if (a.status === "scheduled") {
          return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
        }
        return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
      });
      return { tournament: t, matches: sorted };
    }).filter(Boolean) as { tournament: Tournament; matches: typeof matches }[];
  }, [matches, tournamentLookup]);

  if (isFetchingMatches && matches.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (matchError && matches.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-8 text-center">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-300">{matchError}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" variant="outline" onClick={refreshMatches}>
            Thử lại
          </Button>
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-700 bg-slate-800/30 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-500">
          <Inbox className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-300">
            Không có trận đấu nào trong ngày {formatDateVi(parseDateKey(selectedDate))}
          </p>
          {isUsingLiveData ? (
            <div className="mt-2 space-y-1 text-xs text-slate-500">
              <div className="flex items-center justify-center gap-1.5">
                <Globe2 className="h-3 w-3" />
                <span>Đã gọi Tennis API thành công — không có trận nào được lên lịch cho ngày này.</span>
              </div>
              {lastFetchedAt && (
                <div className="text-slate-600">
                  Cập nhật lần cuối: {formatTime(lastFetchedAt)}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              Hãy chọn ngày khác hoặc quay lại vào ngày thi đấu
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {isUsingLiveData && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                setIsSearching(true);
                try {
                  await findNearbyDateWithMatches(7);
                } finally {
                  setIsSearching(false);
                }
              }}
              disabled={isSearching}
              title="Tìm ngày gần nhất có trận đấu"
            >
              {isSearching ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Đang tìm...
                </>
              ) : (
                <>
                  <Calendar className="h-3.5 w-3.5" />
                  Tìm ngày khác có trận
                </>
              )}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={refreshMatches}>
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <DaySummary
        totalMatches={matches.length}
        liveCount={matches.filter((m) => m.status === "live").length}
        completedCount={matches.filter((m) => m.status === "completed").length}
        scheduledCount={matches.filter((m) => m.status === "scheduled").length}
        tournamentCount={tournaments.length}
        lastFetchedAt={lastFetchedAt}
        isUsingLiveData={isUsingLiveData}
        onRefresh={refreshMatches}
      />
      {groups.map(({ tournament, matches: ms }) => (
        <TournamentCard
          key={tournament.id}
          tournament={tournament}
          matches={ms}
          onOpenReport={onOpenReport}
          onOpenScheduleModal={onOpenScheduleModal}
        />
      ))}
    </div>
  );
}

function DaySummary({
  totalMatches,
  liveCount,
  completedCount,
  scheduledCount,
  tournamentCount,
  lastFetchedAt,
  isUsingLiveData,
  onRefresh,
}: {
  totalMatches: number;
  liveCount: number;
  completedCount: number;
  scheduledCount: number;
  tournamentCount: number;
  lastFetchedAt: Date | null;
  isUsingLiveData: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2.5 text-xs">
      <div className="flex items-center gap-1.5 text-slate-300">
        <span className="text-base font-semibold tabular-nums">{totalMatches}</span>
        <span className="text-slate-400">trận</span>
      </div>
      <span className="text-slate-700">·</span>
      <div className="flex items-center gap-1.5 text-slate-300">
        <span className="text-base font-semibold tabular-nums">{tournamentCount}</span>
        <span className="text-slate-400">giải</span>
      </div>
      {liveCount > 0 && (
        <>
          <span className="text-slate-700">·</span>
          <span className="inline-flex items-center gap-1 font-medium text-red-300">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
            {liveCount} live
          </span>
        </>
      )}
      {completedCount > 0 && (
        <>
          <span className="text-slate-700">·</span>
          <span className="text-emerald-300">{completedCount} xong</span>
        </>
      )}
      {scheduledCount > 0 && (
        <>
          <span className="text-slate-700">·</span>
          <span className="text-slate-300">{scheduledCount} sắp</span>
        </>
      )}
      <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
        {lastFetchedAt && (
          <span>
            Cập nhật {formatTime(lastFetchedAt)}
            {isUsingLiveData ? " · Live API" : " · cache"}
          </span>
        )}
        <button
          onClick={onRefresh}
          className="rounded-md border border-slate-700 px-2 py-0.5 text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
          title="Refresh"
        >
          ↻ Refresh
        </button>
      </div>
    </div>
  );
}
