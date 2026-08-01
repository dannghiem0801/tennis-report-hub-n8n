/**
 * ScheduleBatchModal — create a new ScheduledBatch (ADR 0001).
 *
 * Flow contract (Q-final):
 *   1. User picks matches on the dashboard → ⭐ adds them to watchlist
 *   2. User clicks 🕐 on a match row (or "Tạo batch mới" in sidebar)
 *   3. Modal opens showing the user's CURRENT WATCHLIST ENTRIES
 *   4. User multi-selects which entries go into the batch
 *   5. User picks a time (preset or custom)
 *   6. Submit → batch is created
 *
 * The modal is a SELECTION surface only. It does NOT add new matches to
 * the watchlist — that's the dashboard's job. This keeps the data
 * flow unidirectional: dashboard owns watchlist mutations, modal only
 * reads + references existing entries.
 *
 * Time picker: preset-first (5 one-click options) with a custom
 * `<input type="datetime-local">` fallback. Constraint banner
 * documents the tab-open requirement (Q5=A).
 */

import { useEffect, useMemo, useState } from "react";
import { Clock, AlertCircle, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useApp } from "@/store/app-store";
import { cn, formatTime } from "@/lib/utils";

interface ScheduleBatchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected MATCH ids (resolved to watchlist entry ids on open).
   *  Used when the user opens the modal from a match row's 🕐 button.
   *  If the match isn't in the watchlist yet, it's silently ignored
   *  here — the caller is expected to have added it to the watchlist
   *  first (see DashboardPage.openScheduleForMatch). */
  preSelectedMatchIds?: string[];
}

type PresetKey = "30m" | "1h" | "2h" | "tonight" | "tomorrow" | "custom";

interface PresetDef {
  key: PresetKey;
  label: string;
  resolve: (now: Date) => string;
  hint: string;
}

const PRESETS: PresetDef[] = [
  {
    key: "30m",
    label: "+30 phút",
    resolve: (now) => new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    hint: "Deadline gấp",
  },
  {
    key: "1h",
    label: "+1 giờ",
    resolve: (now) => new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    hint: "Mặc định",
  },
  {
    key: "2h",
    label: "+2 giờ",
    resolve: (now) => new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    hint: "Có thời gian edit",
  },
  {
    key: "tonight",
    label: "Tối nay 22:00",
    resolve: (now) => {
      const d = new Date(now);
      d.setHours(22, 0, 0, 0);
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
      return d.toISOString();
    },
    hint: "22:00 hôm nay (hoặc mai nếu đã qua)",
  },
  {
    key: "tomorrow",
    label: "Sáng mai 8:00",
    resolve: (now) => {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(8, 0, 0, 0);
      return d.toISOString();
    },
    hint: "8:00 sáng hôm sau",
  },
];

export function ScheduleBatchModal({
  open,
  onOpenChange,
  preSelectedMatchIds = [],
}: ScheduleBatchModalProps) {
  const { watchlist, addScheduledBatch } = useApp();

  // Selected WatchlistEntry ids that will go into the batch.
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    new Set()
  );
  const [preset, setPreset] = useState<PresetKey>("1h");
  const [customDate, setCustomDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Re-seed selection when the modal opens. We resolve the pre-selected
  // match ids to their current watchlist entry ids. If a match id has
  // no corresponding entry (caller forgot to add it first), we ignore
  // it — the entry list below is the source of truth.
  //
  // Note: deliberately NOT depending on `watchlist` here. Re-running on
  // every watchlist change would clobber the user's manual deselection
  // if a new entry is added while the modal is open. React commits the
  // batched state update (addToWatchlist + open modal) in a single
  // render, so by the time this effect runs the watchlist already
  // contains the new entry from the same click.
  useEffect(() => {
    if (!open) return;
    const entryIds = new Set<string>();
    for (const matchId of preSelectedMatchIds) {
      const entry = watchlist.find((e) => e.matchApiId === matchId);
      if (entry && !entry.batchId) entryIds.add(entry.id);
    }
    setSelectedEntryIds(entryIds);
    setPreset("1h");
    setCustomDate("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preSelectedMatchIds]);

  // Available entries: in watchlist, not already in another batch
  // (Q8 — one entry per batch; user should remove from old batch first).
  const availableEntries = useMemo(
    () => watchlist.filter((e) => !e.batchId),
    [watchlist]
  );

  const toggleEntry = (id: string) => {
    setSelectedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedEntryIds(new Set(availableEntries.map((e) => e.id)));
  };
  const deselectAll = () => {
    setSelectedEntryIds(new Set());
  };

  const fireAt = useMemo(() => {
    if (preset === "custom") {
      if (!customDate) return null;
      const d = new Date(customDate);
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
    }
    const def = PRESETS.find((p) => p.key === preset);
    if (!def) return null;
    return def.resolve(new Date());
  }, [preset, customDate]);

  const canSubmit =
    selectedEntryIds.size > 0 && !!fireAt && fireAt > new Date().toISOString();

  const handleSubmit = () => {
    if (!canSubmit || !fireAt) return;
    setSubmitting(true);
    try {
      const entryIds = Array.from(selectedEntryIds);
      addScheduledBatch({
        name: `Batch ${new Date(fireAt).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        })} — ${entryIds.length} trận`,
        fireAt,
        watchlistEntryIds: entryIds,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-400" />
            Hẹn giờ viết báo cáo
          </DialogTitle>
          <DialogDescription>
            Chọn trận từ watchlist và đặt deadline. Tại thời điểm đó, các trận
            đã kết thúc sẽ được LLM viết báo cáo (safety net). Trận chưa kết
            thúc sẽ chờ auto-on-completion.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Match selection — from watchlist only */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Trận sẽ viết báo cáo ({selectedEntryIds.size}/{availableEntries.length})
              </span>
              {availableEntries.length > 0 && (
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    Chọn tất cả
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={deselectAll}
                    className="text-slate-400 hover:text-slate-200"
                  >
                    Bỏ chọn
                  </button>
                </div>
              )}
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-800 bg-slate-900/40 p-2">
              {availableEntries.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-slate-500">
                  Watchlist đang trống. Vào dashboard, nhấn ⭐ để thêm trận vào
                  watchlist trước, rồi quay lại đây.
                </div>
              ) : (
                availableEntries.map((entry) => (
                  <EntryCheckboxRow
                    key={entry.id}
                    checked={selectedEntryIds.has(entry.id)}
                    label={`${entry.player1Name} vs ${entry.player2Name}`}
                    sublabel={`${formatTime(new Date(entry.startTime))} · ${entry.tournamentName.split("—")[0]?.trim()}`}
                    onToggle={() => toggleEntry(entry.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Time picker */}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Thời điểm kích hoạt
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.key}
                  size="sm"
                  variant={preset === p.key ? "default" : "outline"}
                  onClick={() => {
                    setPreset(p.key);
                    setCustomDate("");
                  }}
                  title={p.hint}
                  className="text-[11px]"
                >
                  {p.label}
                </Button>
              ))}
              <Button
                size="sm"
                variant={preset === "custom" ? "default" : "outline"}
                onClick={() => setPreset("custom")}
                className="text-[11px]"
              >
                Tuỳ chỉnh…
              </Button>
            </div>
            {preset === "custom" && (
              <input
                type="datetime-local"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="mt-2 w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            )}
            {fireAt && (
              <div className="mt-2 text-[11px] text-slate-400">
                Sẽ kích hoạt lúc:{" "}
                <span className="font-mono text-slate-200">
                  {new Date(fireAt).toLocaleString("vi-VN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </span>
              </div>
            )}
          </div>

          {/* Constraint banner */}
          <div className="flex items-start gap-2 rounded-md border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-[11px] text-amber-200/90">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
            <div>
              <strong>Giữ tab mở</strong> để schedule chạy. Đóng tab sẽ làm mất
              batch — không có recovery cho đến khi bạn mở lại (batch sẽ chạy
              ngay khi mở, nếu đã tới giờ).
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting ? "Đang tạo…" : "Tạo batch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntryCheckboxRow({
  checked,
  label,
  sublabel,
  onToggle,
}: {
  checked: boolean;
  label: string;
  sublabel?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[12px] transition-colors",
        checked
          ? "border-blue-700/60 bg-blue-900/20 text-slate-100"
          : "border-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-800/40"
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border",
          checked
            ? "border-blue-500 bg-blue-600 text-white"
            : "border-slate-600 bg-slate-800"
        )}
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {sublabel && (
          <span className="block truncate text-[10px] text-slate-500">
            {sublabel}
          </span>
        )}
      </span>
    </button>
  );
}
