import { Link, NavLink } from "react-router-dom";
import { Calendar, ChevronLeft, ChevronRight, RefreshCw, History, FileText, Settings as SettingsIcon, Activity } from "lucide-react";
import { useApp } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { cn, formatDateVi, formatDateKey, parseDateKey, timeAgo } from "@/lib/utils";
import type { Sport } from "@/types";

/**
 * Top-level sport selector. v1.5 enables Tennis + Football; Basketball
 * is "Coming Soon". Toggling football requires a re-fetch of the
 * dashboard for sportId=1, which `setActiveSport` triggers via
 * activeSport context value.
 */
const SPORTS: { id: Sport; label: string; active: boolean; flag: string }[] = [
  { id: "tennis", label: "Tennis", active: true, flag: "🎾" },
  { id: "football", label: "Bóng đá", active: true, flag: "⚽" },
  { id: "basketball", label: "Bóng rổ", active: false, flag: "🏀" },
];

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: Activity },
  { to: "/reports", label: "Báo cáo", icon: History },
  { to: "/templates", label: "Mẫu báo cáo", icon: FileText },
  { to: "/settings", label: "Cài đặt", icon: SettingsIcon },
] as const;

export function TopBar() {
  const {
    activeSport,
    setActiveSport,
    selectedDate,
    setSelectedDate,
    refreshMatches,
    isFetchingMatches,
    lastFetchedAt,
    matchError,
  } = useApp();
  const today = formatDateKey(new Date());
  const isToday = selectedDate === today;
  const dateLabel = isToday
    ? `Hôm nay — ${formatDateVi(parseDateKey(selectedDate))}`
    : formatDateVi(parseDateKey(selectedDate));

  const goDay = (delta: number) => {
    const d = parseDateKey(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(formatDateKey(d));
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/95 backdrop-blur supports-[backdrop-filter]:bg-slate-900/80">
      {/* Sports selector row */}
      <div className="flex items-center gap-1 border-b border-slate-800/60 px-4 py-1.5">
        <Link to="/" className="mr-3 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/20 text-base">
            {activeSport === "football" ? "⚽" : "🎾"}
          </div>
          <span className="text-sm font-semibold tracking-tight text-slate-100">
            {activeSport === "football" ? "Sports Report Hub" : "Tennis Report Hub"}
          </span>
        </Link>
        <div className="ml-2 flex items-center gap-1">
          {SPORTS.map((sport) => {
            const isActive = sport.id === activeSport;
            return (
              <button
                key={sport.id}
                type="button"
                disabled={!sport.active}
                onClick={() => sport.active && setActiveSport(sport.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  sport.active && isActive
                    ? "bg-blue-500/15 text-blue-300"
                    : sport.active
                    ? "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                    : "cursor-not-allowed text-slate-500"
                )}
                title={
                  sport.active
                    ? isActive
                      ? `Đang xem ${sport.label}`
                      : `Chuyển sang ${sport.label}`
                    : "Sắp ra mắt"
                }
              >
                <span>{sport.flag}</span>
                <span>{sport.label}</span>
                {!sport.active && (
                  <span className="rounded bg-slate-700/60 px-1 py-0.5 text-[9px] uppercase tracking-wide text-slate-400">
                    Soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date + Nav row */}
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-800/40 p-0.5">
          <Button variant="ghost" size="icon-sm" onClick={() => goDay(-1)} title="Ngày trước">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <div className="flex items-center gap-2 px-2 text-xs">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-medium text-slate-200">{dateLabel}</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) setSelectedDate(e.target.value);
              }}
              className="ml-1 cursor-pointer rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-300 focus:border-blue-500 focus:outline-none"
              title="Chọn ngày cụ thể"
            />
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => goDay(1)} title="Ngày sau">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          {!isToday && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedDate(today)}
              className="ml-1 h-7 px-2 text-[11px] text-blue-300 hover:text-blue-200"
              title="Về hôm nay"
            >
              Hôm nay
            </Button>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={refreshMatches}
          disabled={isFetchingMatches}
          className="gap-1.5"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetchingMatches && "animate-spin")} />
          {isFetchingMatches ? "Đang tải" : "Làm mới"}
        </Button>

        {lastFetchedAt && !matchError && (
          <span className="text-[11px] text-slate-500">
            Cập nhật lần cuối: {timeAgo(lastFetchedAt)}
          </span>
        )}

        {matchError && (
          <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300">
            {matchError}
          </span>
        )}

        <nav className="ml-auto flex items-center gap-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-slate-800 text-slate-100"
                      : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                  )
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
