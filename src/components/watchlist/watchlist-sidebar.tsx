import { useMemo, useState } from "react";
import { Star, X, FileText, Trash2, Sparkles, Clock, ChevronDown } from "lucide-react";
import { useApp } from "@/store/app-store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn, formatDateShort, formatTime } from "@/lib/utils";
import { SCHEDULE_FEATURE_ENABLED } from "@/lib/feature-flags";
import { WatchlistStatusBadge } from "@/components/ui/status-badge";
import { ScheduledBatchesPanel } from "@/components/schedule/scheduled-batches-panel";
import type { Report, Sport, WatchlistEntry } from "@/types";

interface WatchlistSidebarProps {
  onOpenReport?: (matchId: string) => void;
  onOpenScheduleModal?: () => void;
}

/**
 * Sport section metadata (label + flag). Order here is the order
 * sections render in the sidebar. Per ADR 0002, the watchlist is
 * sport-agnostic but rendered with per-sport group headers so the
 * user can still see which sport a match belongs to.
 */
const SPORT_META: Record<Sport, { label: string; flag: string }> = {
  tennis: { label: "Tennis", flag: "🎾" },
  football: { label: "Bóng đá", flag: "⚽" },
  basketball: { label: "Bóng rổ", flag: "🏀" },
};

/**
 * Group a list of items by `sport`, preserving the canonical order
 * from `Object.keys(SPORT_META)`. Empty sport groups are filtered
 * out so we don't render headers for sports the user has no entries
 * in.
 */
function groupBySport<T extends { sport: Sport }>(
  items: T[]
): Array<{ sport: Sport; items: T[] }> {
  const by = new Map<Sport, T[]>();
  for (const item of items) {
    const list = by.get(item.sport);
    if (list) list.push(item);
    else by.set(item.sport, [item]);
  }
  return Object.keys(SPORT_META)
    .filter((s): s is Sport => by.has(s as Sport))
    .map((sport) => ({ sport, items: by.get(sport) ?? [] }));
}

/**
 * Sort entries by start time. Pending tab = ascending (next match
 * first); completed tab = descending (most recent first). The sort
 * is on the ISO `startTime` string, which sorts correctly as a date.
 */
function sortByStartTime<T extends { startTime: string }>(
  items: T[],
  dir: "asc" | "desc"
): T[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => a.startTime.localeCompare(b.startTime) * factor);
}

export function WatchlistSidebar({ onOpenReport, onOpenScheduleModal }: WatchlistSidebarProps) {
  const { watchlist, reports, isWatchlisted, toggleWatchlist, markReportSeen, scheduledBatches } = useApp();
  const pending = useMemo(
    () => watchlist.filter((w) => w.status !== "completed"),
    [watchlist]
  );
  const completed = useMemo(
    () => watchlist.filter((w) => w.status === "completed"),
    [watchlist]
  );
  const activeBatches = scheduledBatches.filter(
    (b) => b.status === "pending" || b.status === "running"
  );
  void isWatchlisted;
  void toggleWatchlist;

  // Pre-compute grouped+sorted lists so the same computation isn't
  // repeated across renders. ADR 0002: group by sport, sort by start
  // time within each group.
  const pendingGroups = useMemo(
    () => groupBySport(sortByStartTime(pending, "asc")),
    [pending]
  );
  const completedGroups = useMemo(
    () => groupBySport(sortByStartTime(completed, "desc")),
    [completed]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-800/40">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          <span className="text-sm font-semibold text-slate-100">Watchlist của tôi</span>
        </div>
        <span className="text-[11px] text-slate-500">
          {watchlist.length} trận
        </span>
      </div>

      <Tabs defaultValue="pending" className="flex flex-1 flex-col overflow-hidden">
        <div className="px-4 pt-2">
          <TabsList
            className={cn(
              "grid w-full",
              SCHEDULE_FEATURE_ENABLED ? "grid-cols-3" : "grid-cols-2"
            )}
          >
            <TabsTrigger value="pending">
              Đang chờ <span className="ml-1 text-slate-500">({pending.length})</span>
            </TabsTrigger>
            <TabsTrigger value="completed">
              Đã viết <span className="ml-1 text-slate-500">({completed.length})</span>
            </TabsTrigger>
            {SCHEDULE_FEATURE_ENABLED && (
              <TabsTrigger value="scheduled">
                <Clock className="mr-0.5 h-3 w-3" />
                Hẹn giờ <span className="ml-1 text-slate-500">({activeBatches.length})</span>
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="pending" className="m-0 flex-1 overflow-y-auto px-2 pb-2 pt-2">
          {pending.length === 0 ? (
            <EmptyState
              title="Chưa có trận nào đang chờ"
              description="Bạn chưa theo dõi trận nào. Duyệt lịch đấu và nhấn ⭐ để thêm."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {pendingGroups.map(({ sport, items }) => (
                <SportSection
                  key={sport}
                  sport={sport}
                  count={items.length}
                >
                  {items.map((entry) => (
                    <PendingItem key={entry.id} entry={entry} />
                  ))}
                </SportSection>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed" className="m-0 flex-1 overflow-y-auto px-2 pb-2 pt-2">
          {completed.length === 0 ? (
            <EmptyState
              title="Chưa có báo cáo nào"
              description="Khi trận bạn theo dõi kết thúc, báo cáo sẽ tự động xuất hiện tại đây."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {completedGroups.map(({ sport, items }) => (
                <SportSection
                  key={sport}
                  sport={sport}
                  count={items.length}
                >
                  {items.map((entry) => {
                    const report = reports.find((r) => r.watchlistId === entry.id);
                    if (!report) return null;
                    return (
                      <CompletedItem
                        key={entry.id}
                        entry={entry}
                        report={report}
                        onOpenReport={() => {
                          markReportSeen(report.id);
                          onOpenReport?.(entry.matchApiId);
                        }}
                      />
                    );
                  })}
                </SportSection>
              ))}
            </div>
          )}
        </TabsContent>

        {SCHEDULE_FEATURE_ENABLED && (
          <TabsContent value="scheduled" className="m-0 flex-1 overflow-y-auto px-2 pb-2 pt-2">
            <ScheduledBatchesPanel
              onCreateBatch={() => onOpenScheduleModal?.()}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

/**
 * Per-sport group header. Collapsible — the user can collapse a
 * sport section to focus on the other(s). Default state: expanded.
 * Persists nothing; on reload, all sections start expanded.
 */
function SportSection({
  sport,
  count,
  children,
}: {
  sport: Sport;
  count: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const meta = SPORT_META[sport];
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 transition-colors hover:text-slate-200"
        aria-expanded={!collapsed}
        title={collapsed ? `Mở rộng ${meta.label}` : `Thu gọn ${meta.label}`}
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            collapsed && "-rotate-90"
          )}
        />
        <span>{meta.flag}</span>
        <span>{meta.label}</span>
        <span className="font-mono text-[10px] text-slate-500">({count})</span>
      </button>
      {!collapsed && <div className="flex flex-col gap-1.5">{children}</div>}
    </div>
  );
}

function PendingItem({
  entry,
}: {
  entry: WatchlistEntry;
  onOpenReport?: (matchId: string) => void;
}) {
  const { removeFromWatchlist } = useApp();
  const startTime = new Date(entry.startTime);
  // Per-row sport chip (ADR 0002): even when the section is
  // collapsed, the user can still tell which sport the match is.
  const sportFlag = SPORT_META[entry.sport].flag;
  return (
    <div className="group rounded-md border border-slate-800 bg-slate-900/40 p-2.5 transition-colors hover:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12px] text-slate-200">
            <span
              className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm bg-slate-800/80 text-[10px]"
              title={SPORT_META[entry.sport].label}
              aria-label={SPORT_META[entry.sport].label}
            >
              {sportFlag}
            </span>
            <span>{entry.side1Flag}</span>
            <span className="truncate font-medium">
              {entry.side1Name}
            </span>
            <span className="text-slate-500">vs</span>
            <span>{entry.side2Flag}</span>
            <span className="truncate font-medium">
              {entry.side2Name}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
            <span className="font-mono">{formatTime(startTime)}</span>
            <span>•</span>
            <span className="truncate">{entry.tournamentName.split("—")[0]?.trim()}</span>
            <span>•</span>
            <span>{formatDateShort(entry.matchDate)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <WatchlistStatusBadge status={entry.status} errorMessage={entry.errorMessage} />
            {entry.batchId && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full border border-blue-700/60 bg-blue-900/30 px-1.5 py-0.5 text-[9px] font-medium text-blue-300"
                title="Trận này thuộc 1 batch hẹn giờ"
              >
                <Clock className="h-2.5 w-2.5" />
                Hẹn giờ
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => removeFromWatchlist(entry.id)}
          title="Bỏ theo dõi"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function CompletedItem({
  entry,
  report,
  onOpenReport,
}: {
  entry: WatchlistEntry;
  report: Report;
  onOpenReport: () => void;
}) {
  const { removeFromWatchlist } = useApp();
  const [copied, setCopied] = useState(false);
  const preview = report.content
    .replace(/\*\*/g, "")
    .replace(/\n+/g, " ")
    .slice(0, 110);
  // Per-row sport chip (ADR 0002): keeps the sport visible when
  // sections are collapsed.
  const sportFlag = SPORT_META[entry.sport].flag;
  const sportLabel = SPORT_META[entry.sport].label;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(report.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className={cn(
        "group relative cursor-pointer rounded-md border bg-slate-900/40 p-2.5 transition-colors hover:border-slate-700",
        report.isNew ? "border-emerald-500/30" : "border-slate-800"
      )}
      onClick={onOpenReport}
    >
      {report.isNew && (
        <span className="absolute -right-1 -top-1 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white shadow">
          Mới
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm bg-slate-800/80 text-[10px]"
              title={sportLabel}
              aria-label={sportLabel}
            >
              {sportFlag}
            </span>
            <h4 className="line-clamp-2 text-[12px] font-semibold leading-snug text-slate-100">
              {report.title}
            </h4>
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-400">
            {preview}…
          </p>
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-500">
            <span>{formatDateShort(report.generatedAt)}</span>
            {entry.finalScore && (
              <>
                <span>•</span>
                <span className="font-mono text-slate-400">{entry.finalScore}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-6 flex-1 px-2 text-[11px]"
          onClick={(e) => {
            e.stopPropagation();
            onOpenReport();
          }}
        >
          <FileText className="h-3 w-3" />
          Đọc
        </Button>
        <Button
          size="sm"
          variant={copied ? "success" : "ghost"}
          className="h-6 px-2 text-[11px]"
          onClick={handleCopy}
        >
          {copied ? "✓ Đã copy" : "Copy"}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            removeFromWatchlist(entry.id);
          }}
          title="Xóa khỏi watchlist"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-slate-700 bg-slate-900/30 p-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-slate-500">
        <Sparkles className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs font-medium text-slate-300">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          {description}
        </p>
      </div>
    </div>
  );
}
