import { useEffect, useState } from "react";
import { TournamentBrowser } from "@/components/dashboard/tournament-browser";
import { WatchlistSidebar } from "@/components/watchlist/watchlist-sidebar";
import { ReportViewer } from "@/components/reports/report-viewer";
import { ScheduleBatchModal } from "@/components/schedule/schedule-batch-modal";
import { BatchProgressWidget } from "@/components/schedule/batch-progress-widget";
import { SCHEDULE_FEATURE_ENABLED } from "@/lib/feature-flags";
import { useApp } from "@/store/app-store";
import {
  Sparkles,
  FileText,
  ChevronRight,
  AlertTriangle,
  Database,
  Globe2,
  X,
  Clock,
  RefreshCw,
  Calendar,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatDateVi, formatTime, parseDateKey } from "@/lib/utils";

export function DashboardPage() {
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleMatchIds, setScheduleMatchIds] = useState<string[]>([]);
  const {
    reports,
    matchError,
    dismissMatchError,
    isRateLimited,
    rateLimitUntil,
    refreshMatches,
    isDateAutoPicked,
    userSelectedDate,
    selectedDate,
    setSelectedDate,
  } = useApp();

  const openScheduleForMatch = (matchId: string) => {
    setScheduleMatchIds([matchId]);
    setScheduleModalOpen(true);
  };
  const openScheduleBlank = () => {
    setScheduleMatchIds([]);
    setScheduleModalOpen(true);
  };

  return (
    <div className="grid grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex flex-col gap-3 min-w-0">
        <DashboardHeader />
        {isRateLimited && rateLimitUntil && (
          <RateLimitBanner until={rateLimitUntil} onRetry={refreshMatches} />
        )}
        {matchError && !isRateLimited && (
          <ErrorBanner message={matchError} onDismiss={dismissMatchError} />
        )}
        {isDateAutoPicked && userSelectedDate !== selectedDate && (
          <AutoPickedBanner
            pickedDate={selectedDate}
            requestedDate={userSelectedDate}
            onBack={() => setSelectedDate(userSelectedDate)}
          />
        )}
        <TournamentBrowser
          onOpenReport={setOpenMatchId}
          onOpenScheduleModal={SCHEDULE_FEATURE_ENABLED ? openScheduleForMatch : undefined}
        />
      </div>

      <div className="flex min-h-[600px] flex-col gap-3 lg:sticky lg:top-[88px] lg:h-[calc(100vh-100px)]">
        <WatchlistSidebar
          onOpenReport={setOpenMatchId}
          onOpenScheduleModal={SCHEDULE_FEATURE_ENABLED ? openScheduleBlank : undefined}
        />
        {reports.length > 0 && (
          <Link
            to="/reports"
            className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-800/30 px-3 py-2 text-[11px] text-slate-400 transition-colors hover:bg-slate-800/50 hover:text-slate-200"
          >
            <span className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Đã có {reports.length} báo cáo trong lịch sử
            </span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      <ReportViewer matchId={openMatchId} onClose={() => setOpenMatchId(null)} />
      {SCHEDULE_FEATURE_ENABLED && (
        <ScheduleBatchModal
          open={scheduleModalOpen}
          onOpenChange={setScheduleModalOpen}
          preSelectedMatchIds={scheduleMatchIds}
        />
      )}
      {SCHEDULE_FEATURE_ENABLED && <BatchProgressWidget />}
    </div>
  );
}

function DashboardHeader() {
  const { isUsingLiveData, lastFetchedAt, refreshMatches, isFetchingMatches, isRateLimited, settings } = useApp();
  const hasApiKey = !!settings.rapidApiKey?.trim();
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/30 px-4 py-2.5">
      <div>
        <h1 className="text-sm font-semibold text-slate-100">
          Lịch thi đấu tennis hôm nay
        </h1>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Chọn trận và nhấn ⭐ để thêm vào watchlist. Báo cáo sẽ tự động sinh sau khi trận kết thúc.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={refreshMatches}
          disabled={isFetchingMatches || isRateLimited}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-800/50 text-slate-300 transition-colors hover:bg-slate-700/60 disabled:cursor-not-allowed disabled:opacity-50"
          title={isRateLimited ? "Đang trong thời gian chờ rate limit" : "Refresh"}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetchingMatches ? "animate-spin" : ""}`} />
        </button>
        <span
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
            isUsingLiveData
              ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300"
              : hasApiKey
                ? "border-slate-700 bg-slate-800/50 text-slate-400"
                : "border-amber-700/60 bg-amber-900/30 text-amber-300"
          }`}
          title={
            isUsingLiveData
              ? "Đang lấy dữ liệu trực tiếp từ Tennis API"
              : hasApiKey
                ? "Đang chờ Tennis API phản hồi (lần fetch đầu hoặc sau lỗi tạm thời)"
                : "Chưa cấu hình Tennis API key. Vào Settings để nhập key."
          }
        >
          {isUsingLiveData ? (
            <>
              <Globe2 className="h-3 w-3" />
              Live API
            </>
          ) : hasApiKey ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Đang chờ API
            </>
          ) : (
            <>
              <Database className="h-3 w-3" />
              Chưa cấu hình
            </>
          )}
        </span>
        {lastFetchedAt && (
          <span className="hidden text-[10px] text-slate-500 sm:inline">
            · Cập nhật {formatTime(lastFetchedAt)}
          </span>
        )}
        <span className="hidden items-center gap-1.5 text-[11px] text-slate-500 sm:flex">
          <Sparkles className="h-3 w-3 text-blue-400" />
          <span>Tự động viết báo cáo tiếng Việt</span>
        </span>
      </div>
    </div>
  );
}

function RateLimitBanner({ until, onRetry }: { until: Date; onRetry: () => void }) {
  const [, force] = useState(0);
  // Tick every second so the countdown updates; clean up on unmount
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = Math.max(0, Math.ceil((until.getTime() - Date.now()) / 1000));
  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
      <Clock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
      <div className="flex-1">
        <div className="font-medium text-red-100">Đang chờ rate limit (90 req/phút)</div>
        <div className="mt-0.5 text-red-200/90">
          Tennis API đã từ chối yêu cầu gần nhất. Auto-refresh và polling sẽ tạm dừng.{remaining > 0 && (
            <> Còn lại <span className="font-mono font-semibold">{mm}:{String(ss).padStart(2, "0")}</span> trước khi có thể thử lại.</>
          )}
          {remaining === 0 && " Có thể thử lại ngay."}
        </div>
        <div className="mt-1 text-[11px] text-red-300/70">
          Mẹo: cache sẽ tự dùng lại khi cooldown kết thúc — trận đã load trước đó không bị mất.
        </div>
      </div>
      <button
        onClick={onRetry}
        disabled={remaining > 0}
        className="rounded border border-red-400/40 bg-red-500/20 px-2 py-1 text-[11px] text-red-100 transition-colors hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Thử lại
      </button>
    </div>
  );
}

function AutoPickedBanner({
  pickedDate,
  requestedDate,
  onBack,
}: {
  pickedDate: string;
  requestedDate: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-[12px] text-blue-100">
      <Calendar className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
      <div className="flex-1">
        <div className="font-medium">Đang hiển thị trận của {formatDateVi(parseDateKey(pickedDate))}</div>
        <div className="mt-0.5 text-blue-200/80">
          Ngày bạn chọn ({formatDateVi(parseDateKey(requestedDate))}) không có trận nào trên API.
          Hệ thống đã tự động tìm ngày gần nhất có trận.
        </div>
      </div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 rounded border border-blue-400/40 bg-blue-500/20 px-2 py-1 text-[11px] text-blue-100 transition-colors hover:bg-blue-500/30"
      >
        <ArrowLeft className="h-3 w-3" />
        Quay lại
      </button>
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-[12px] text-amber-200">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
      <div className="flex-1">
        <div className="font-medium text-amber-100">Tennis API: không tải được dữ liệu mới</div>
        <div className="mt-0.5 text-amber-200/90">{message}</div>
        <div className="mt-1 text-[11px] text-amber-300/70">
          Bấm <strong>Refresh</strong> để thử lại, hoặc vào Settings kiểm tra API key nếu lỗi lặp lại.
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="text-amber-300 hover:text-amber-100"
        title="Đóng thông báo"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
