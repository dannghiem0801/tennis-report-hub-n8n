/**
 * ScheduledBatchesPanel — the "Scheduled" tab in the WatchlistSidebar.
 * Lists user-created ScheduledBatches grouped by status:
 *  - pending (countdown to fireAt)
 *  - running (currently executing)
 *  - completed / partial / cancelled (terminal — show summary)
 *
 * Each batch row has:
 *  - Name + countdown ("còn 1h 23m") or "đang chạy" / "xong lúc …"
 *  - Entry count
 *  - Cancel button (only for pending — running is locked per Q8=D)
 *  - Expandable summary on terminal batches (Q10)
 *
 * The "Tạo batch mới" button at the bottom opens the schedule modal
 * pre-populated with all currently-watched entries.
 */

import { useEffect, useState } from "react";
import {
  Clock,
  Plus,
  X,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { useApp } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScheduledBatch } from "@/types";

interface ScheduledBatchesPanelProps {
  onCreateBatch: () => void;
}

export function ScheduledBatchesPanel({ onCreateBatch }: ScheduledBatchesPanelProps) {
  const { scheduledBatches, cancelScheduledBatch, removeScheduledBatch } = useApp();

  // Sort: running first, then pending by fireAt asc, then terminal by completedAt desc.
  const sorted = [...scheduledBatches].sort((a, b) => {
    const order = (s: ScheduledBatch["status"]) =>
      s === "running" ? 0 : s === "pending" ? 1 : 2;
    const oa = order(a.status);
    const ob = order(b.status);
    if (oa !== ob) return oa - ob;
    if (a.status === "pending" && b.status === "pending") {
      return a.fireAt.localeCompare(b.fireAt);
    }
    return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
  });

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-slate-700 bg-slate-900/30 p-6 text-center">
        <Clock className="h-5 w-5 text-slate-500" />
        <p className="text-xs font-medium text-slate-300">Chưa có batch nào</p>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Tạo batch để đặt deadline viết báo cáo cho nhiều trận cùng lúc.
        </p>
        <Button size="sm" onClick={onCreateBatch} className="mt-1">
          <Plus className="h-3 w-3" />
          Tạo batch mới
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {sorted.map((batch) => (
        <BatchRow
          key={batch.id}
          batch={batch}
          onCancel={() => cancelScheduledBatch(batch.id)}
          onRemove={() => removeScheduledBatch(batch.id)}
        />
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={onCreateBatch}
        className="mt-2 w-full text-[11px]"
      >
        <Plus className="h-3 w-3" />
        Tạo batch mới
      </Button>
    </div>
  );
}

function BatchRow({
  batch,
  onCancel,
  onRemove,
}: {
  batch: ScheduledBatch;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isTerminal =
    batch.status === "completed" ||
    batch.status === "partial" ||
    batch.status === "cancelled";

  return (
    <div
      className={cn(
        "rounded-md border bg-slate-900/40 transition-colors",
        batch.status === "running"
          ? "border-blue-700/60"
          : batch.status === "partial"
            ? "border-amber-700/60"
            : batch.status === "completed"
              ? "border-emerald-700/40"
              : batch.status === "cancelled"
                ? "border-slate-700/60 opacity-70"
                : "border-slate-800"
      )}
    >
      <div className="p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {isTerminal ? (
                <button
                  onClick={() => setExpanded((e) => !e)}
                  className="text-slate-500 hover:text-slate-200"
                  title={expanded ? "Thu gọn" : "Mở rộng"}
                >
                  {expanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
              ) : (
                <Clock className="h-3 w-3 text-blue-400" />
              )}
              <span
                className={cn(
                  "truncate text-[12px] font-medium",
                  batch.status === "cancelled"
                    ? "text-slate-500 line-through"
                    : "text-slate-100"
                )}
                title={batch.name}
              >
                {batch.name}
              </span>
            </div>
            <div className="mt-0.5 ml-5 text-[10px] text-slate-500">
              <BatchSubline batch={batch} />
            </div>
          </div>
          {batch.status === "pending" && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onCancel}
              className="h-6 w-6 text-slate-500 hover:text-red-300"
              title="Huỷ batch"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          {isTerminal && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRemove}
              className="h-6 w-6 text-slate-500 opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
              title="Xoá khỏi lịch sử"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      {expanded && batch.summary && (
        <BatchSummaryView summary={batch.summary} />
      )}
    </div>
  );
}

function BatchSubline({ batch }: { batch: ScheduledBatch }) {
  if (batch.status === "running") {
    return (
      <span className="text-blue-300">
        <span className="pulse-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
        Đang chạy · {batch.watchlistEntryIds.length} trận
      </span>
    );
  }
  if (batch.status === "pending") {
    return <CountdownLine fireAt={batch.fireAt} entryCount={batch.watchlistEntryIds.length} />;
  }
  if (batch.status === "cancelled") {
    return <span>Đã huỷ · {batch.watchlistEntryIds.length} trận</span>;
  }
  // completed / partial
  const s = batch.summary;
  if (!s) return <span>{batch.watchlistEntryIds.length} trận</span>;
  return (
    <span>
      {s.written > 0 && <span className="text-emerald-300">{s.written} đã viết</span>}
      {s.alreadyWritten > 0 && (
        <span className="ml-1 text-slate-400">· {s.alreadyWritten} có sẵn</span>
      )}
      {s.failed > 0 && (
        <span className="ml-1 text-red-300">· {s.failed} lỗi</span>
      )}
      {s.skippedNotEnded > 0 && (
        <span className="ml-1 text-slate-500">· {s.skippedNotEnded} chưa xong</span>
      )}
    </span>
  );
}

function CountdownLine({ fireAt, entryCount }: { fireAt: string; entryCount: number }) {
  // Force re-render every 30s so countdown stays fresh without
  // hammering React with every second.
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const ms = new Date(fireAt).getTime() - Date.now();
  if (ms <= 0) {
    return <span className="text-amber-300">Đã tới giờ — đang chờ claim…</span>;
  }
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  let label: string;
  if (days > 0) label = `còn ${days} ngày ${hours % 24}h`;
  else if (hours > 0) label = `còn ${hours}h ${minutes % 60}m`;
  else label = `còn ${minutes} phút`;
  return (
    <span>
      {label} · {entryCount} trận
    </span>
  );
}

function BatchSummaryView({ summary }: { summary: NonNullable<ScheduledBatch["summary"]> }) {
  return (
    <div className="border-t border-slate-800 bg-slate-950/40 px-2.5 py-2">
      <div className="space-y-0.5 text-[10px] text-slate-400">
        {summary.results.map((r, idx) => {
          const labelMap: Record<string, { icon: React.ReactNode; text: string; tone: string }> = {
            "written": { icon: <Check className="h-2.5 w-2.5" />, text: "Đã viết", tone: "text-emerald-300" },
            "already-written": { icon: <Check className="h-2.5 w-2.5" />, text: "Đã có sẵn", tone: "text-slate-400" },
            "skipped-not-ended": { icon: <Clock className="h-2.5 w-2.5" />, text: "Chưa kết thúc", tone: "text-slate-500" },
            "skipped-cancelled": { icon: <X className="h-2.5 w-2.5" />, text: "Đã huỷ", tone: "text-slate-500" },
            "failed": { icon: <AlertCircle className="h-2.5 w-2.5" />, text: "Lỗi", tone: "text-red-300" },
          };
          const meta = labelMap[r.outcome] ?? { icon: null, text: r.outcome, tone: "text-slate-400" };
          return (
            <div key={r.watchlistId + idx} className="flex items-center justify-between gap-2">
              <span className="truncate">Watchlist {r.watchlistId.slice(0, 6)}…</span>
              <span className={cn("flex items-center gap-1", meta.tone)}>
                {meta.icon}
                {meta.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
