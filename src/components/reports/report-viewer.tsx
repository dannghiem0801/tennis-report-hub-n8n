import { useEffect, useState } from "react";
import { Copy, Pencil, Check, X, Calendar, Trophy, FileText, Sparkles, ClipboardList, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/store/app-store";
import { formatDateVi, formatTime } from "@/lib/utils";
import { TournamentBadge } from "@/components/ui/tournament-badge";
import { formatFinalScore } from "@/lib/format-helpers";
import { PointByPointViewer } from "@/components/reports/point-by-point-viewer";
import type { TennisMatch } from "@/types";

interface ReportViewerProps {
  matchId: string | null;
  onClose: () => void;
}

export function ReportViewer({ matchId, onClose }: ReportViewerProps) {
  const { reports, updateReport, markReportSeen } = useApp();
  const report = reports.find((r) => r.matchApiId === matchId) || null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  useEffect(() => {
    if (report) {
      setDraft(report.content);
      setEditing(false);
      if (report.isNew) markReportSeen(report.id);
    }
  }, [report, markReportSeen]);

  if (!report) return null;
  const match = report.match;
  const startTime = new Date(match.startTime);
  const isPrompt = !!report.isPrompt;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editing ? draft : report.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(report.content);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleSave = () => {
    // If user pastes an LLM response back, the result is no longer a "prompt"
    updateReport(report.id, {
      content: draft,
      title: report.title,
      isPrompt: false,
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(report.content);
    setEditing(false);
  };

  return (
    <Dialog open={!!matchId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-slate-800 px-6 pb-3 pt-5">
          <div className="flex items-center gap-2">
            <TournamentBadge category={match.tournamentCategory} />
            <Badge variant="slate" className="font-mono">
              {match.round}
            </Badge>
            {isPrompt ? (
              <Badge variant="warning" className="gap-1">
                <Sparkles className="h-3 w-3" />
                Prompt · cần LLM
              </Badge>
            ) : report.llmModel ? (
              <Badge variant="success" className="gap-1">
                <Sparkles className="h-3 w-3" />
                AI · {report.llmModel}
              </Badge>
            ) : null}
            <span className="ml-auto text-[11px] text-slate-500">
              Đã tạo: {formatDateVi(new Date(report.generatedAt))}
            </span>
          </div>
          <DialogTitle className="mt-2 text-base leading-snug text-slate-100">
            {report.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDateVi(startTime)} • {formatTime(startTime)}
            </span>
            <span className="flex items-center gap-1">
              <Trophy className="h-3 w-3" />
              {match.tournamentName}
            </span>
            <span>
              <FileText className="mr-1 inline h-3 w-3" />
              {formatFinalScore(match)}
            </span>
          </DialogDescription>
        </DialogHeader>

        {isPrompt && !editing && (
          <div className="mx-6 mt-4 flex flex-col gap-2">
            {report.llmError ? (
              <div className="flex items-start gap-2 rounded-md border border-red-700/40 bg-red-900/15 px-3 py-2 text-[12px] text-red-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
                <div>
                  <div className="font-medium text-red-100">LLM auto-generate thất bại — đã fallback về prompt</div>
                  <div className="mt-0.5 text-red-200/90">
                    Lý do: {report.llmError}. Bấm <strong>Copy prompt</strong> bên dưới → paste vào LLM
                    khác → dán response vào đây qua <strong>Chỉnh sửa</strong> để hoàn tất.
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-[12px] text-amber-200">
                <ClipboardList className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
                <div>
                  <div className="font-medium text-amber-100">Đây là prompt, chưa phải bản tin</div>
                  <div className="mt-0.5 text-amber-200/90">
                    LLM chưa được cấu hình. Bấm <strong>Copy prompt</strong> bên dưới → paste vào
                    ChatGPT / Claude / Gemini → copy response → bấm <strong>Chỉnh sửa</strong> → thay nội
                    dung → Lưu. Hoặc vào Settings → LLM để bật auto-generate.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="px-6 py-5">
          {editing ? (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[420px] font-mono text-[12.5px] leading-relaxed"
            />
          ) : isPrompt ? (
            <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950/60 p-3 font-mono text-[12.5px] leading-relaxed text-slate-300">
              {report.content}
            </pre>
          ) : (
            <article
              className="prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed text-slate-200"
              dangerouslySetInnerHTML={{
                __html: markdownToHtml(report.content),
              }}
            />
          )}

          {/* Point-by-point tabbed viewer — only when we have PBP data
              (match was added to the watchlist and PBP fetch succeeded). */}
          {!isPrompt && (match as TennisMatch).pointByPoint && (match as TennisMatch).pointByPoint!.sets.length > 0 && (
            <PointByPointViewer match={match as TennisMatch} />
          )}
        </div>

        <div className="sticky bottom-0 flex items-center gap-2 border-t border-slate-800 bg-slate-900/95 px-6 py-3 backdrop-blur">
          {editing ? (
            <>
              <Button variant="ghost" onClick={handleCancel} size="sm">
                <X className="h-3.5 w-3.5" />
                Hủy
              </Button>
              <Button variant="default" onClick={handleSave} size="sm">
                <Check className="h-3.5 w-3.5" />
                Lưu thay đổi
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(true)} size="sm">
                <Pencil className="h-3.5 w-3.5" />
                {isPrompt ? "Dán response LLM" : "Chỉnh sửa"}
              </Button>
              <Button
                variant="default"
                onClick={isPrompt ? handleCopyPrompt : handleCopy}
                size="sm"
                className="ml-auto"
              >
                {(isPrompt ? copiedPrompt : copied) ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Đã copy
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    {isPrompt ? "Copy prompt" : "Copy báo cáo"}
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* Minimal markdown → HTML for the recap reports */
function markdownToHtml(md: string): string {
  return md
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
        return `<h3 class="text-sm font-semibold text-slate-100 mt-3 mb-1.5">${escapeHtml(trimmed.replace(/\*\*/g, ""))}</h3>`;
      }
      // bold within paragraph
      const html = escapeHtml(trimmed).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      return `<p class="mb-2.5 text-slate-300">${html}</p>`;
    })
    .join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

