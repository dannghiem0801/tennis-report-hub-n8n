/**
 * BatchProgressWidget — corner card showing a running ScheduledBatch.
 * Renders ONLY when `hasRunningBatch` is true. Self-dismisses after
 * a successful run (collapses to a toast for 5s then unmounts).
 *
 * Visual is a compact card fixed to bottom-right (Q10=C). When the
 * batch completes (status moves from "running" to a terminal state),
 * the card switches to a summary view for 5 seconds, then unmounts.
 */

import { useEffect, useState } from "react";
import { Clock, Check, X } from "lucide-react";
import { useApp } from "@/store/app-store";
import { cn } from "@/lib/utils";

export function BatchProgressWidget() {
  const { scheduledBatches } = useApp();
  const running = scheduledBatches.find((b) => b.status === "running");
  const justFinished = scheduledBatches.find(
    (b) => b.status === "completed" || b.status === "partial"
  );
  // We only show the "just finished" card once per run completion.
  // Track which batchId we've already celebrated to avoid re-showing
  // on every re-render.
  const [celebratedId, setCelebratedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    // Reset celebration tracker when a new run starts.
    if (running) {
      setCelebratedId(null);
      setHidden(false);
    }
  }, [running?.id]);

  useEffect(() => {
    // Auto-dismiss the finished card after 5s.
    if (justFinished && justFinished.id !== celebratedId) {
      setCelebratedId(justFinished.id);
      const id = window.setTimeout(() => setHidden(true), 5000);
      return () => window.clearTimeout(id);
    }
  }, [justFinished, celebratedId]);

  if (hidden) return null;
  if (running) {
    return (
      <div className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border border-blue-700/50 bg-slate-900/95 p-3 shadow-2xl backdrop-blur">
        <RunningCard batchName={running.name} total={running.watchlistEntryIds.length} />
      </div>
    );
  }
  if (justFinished) {
    return (
      <div
        className={cn(
          "fixed bottom-4 right-4 z-40 w-80 rounded-lg border bg-slate-900/95 p-3 shadow-2xl backdrop-blur",
          justFinished.status === "completed"
            ? "border-emerald-700/50"
            : "border-amber-700/50"
        )}
      >
        <FinishedCard batch={justFinished} onDismiss={() => setHidden(true)} />
      </div>
    );
  }
  return null;
}

function RunningCard({ batchName, total }: { batchName: string; total: number }) {
  return (
    <>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-300">
        <Clock className="h-3 w-3" />
        Batch đang chạy
      </div>
      <div className="mb-2 truncate text-[13px] font-medium text-slate-100" title={batchName}>
        {batchName}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
          <span>Đang xử lý {total} trận (strict serial — 1 LLM call tại 1 thời điểm)</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500/70" />
        </div>
      </div>
      <div className="mt-2 text-[10px] text-slate-500">
        Mở tab "Scheduled" trong Watchlist để theo dõi chi tiết.
      </div>
    </>
  );
}

function FinishedCard({
  batch,
  onDismiss,
}: {
  batch: ReturnType<typeof useApp>["scheduledBatches"][number];
  onDismiss: () => void;
}) {
  const s = batch.summary;
  const ok = batch.status === "completed";
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide",
            ok ? "text-emerald-300" : "text-amber-300"
          )}
        >
          {ok ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          Batch {ok ? "hoàn thành" : "hoàn thành một phần"}
        </div>
        <button
          onClick={onDismiss}
          className="text-slate-500 hover:text-slate-200"
          title="Đóng"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {s && (
        <div className="space-y-1 text-[12px] text-slate-300">
          <SummaryLine label="Đã viết" value={s.written} tone="success" />
          {s.alreadyWritten > 0 && (
            <SummaryLine label="Đã có sẵn" value={s.alreadyWritten} tone="muted" />
          )}
          {s.skippedNotEnded > 0 && (
            <SummaryLine label="Chưa kết thúc" value={s.skippedNotEnded} tone="muted" />
          )}
          {s.failed > 0 && <SummaryLine label="Lỗi" value={s.failed} tone="danger" />}
          <div className="mt-1 text-[10px] text-slate-500">
            Tổng: {s.total} trận. Xem chi tiết trong tab "Scheduled".
          </div>
        </div>
      )}
    </>
  );
}

function SummaryLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "muted" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-300"
      : tone === "danger"
        ? "text-red-300"
        : "text-slate-400";
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className={cn("font-mono font-semibold", toneClass)}>{value}</span>
    </div>
  );
}
