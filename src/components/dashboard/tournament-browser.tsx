import { useMemo, useState } from "react";
import { useApp } from "@/store/app-store";
import { TournamentCard } from "./tournament-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Tournament } from "@/types";
import { AlertCircle, Inbox, Globe2, Calendar, Loader2, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
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
    settings,
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

  const hasApiKey = !!settings.rapidApiKey?.trim();

  if (isFetchingMatches && matches.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  // No API key configured — show setup guidance instead of generic error
  if (!hasApiKey && !matchError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-amber-700/40 bg-amber-900/10 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
          <SettingsIcon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-100">
            Chưa cấu hình Tennis API key
          </p>
          <p className="mt-1.5 max-w-md text-xs text-slate-400">
            App hiện chỉ lấy dữ liệu thật từ Tennis API (RapidAPI). Vào Settings dán
            key của bạn vào ô "RapidAPI Key", bấm Test connection để xác nhận, rồi
            quay lại Dashboard.
          </p>
          <p className="mt-2 text-[11px] text-slate-500">
            Chưa có key? Đăng ký tại{" "}
            <a
              href="https://rapidapi.com/search/livescore6%20tennis"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:text-blue-300"
            >
              livescore6 tennis trên RapidAPI
            </a>
            .
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/settings">
            <SettingsIcon className="h-3.5 w-3.5" />
            Mở Settings
          </Link>
        </Button>
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
          {!hasApiKey && (
            <Button asChild size="sm" variant="ghost">
              <Link to="/settings">
                <SettingsIcon className="h-3.5 w-3.5" />
                Mở Settings
              </Link>
            </Button>
          )}
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
