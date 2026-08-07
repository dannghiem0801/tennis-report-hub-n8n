import { useMemo, useState } from "react";
import { useApp } from "@/store/app-store";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Check, Search, Calendar, FileText, Edit3, Inbox } from "lucide-react";
import { formatDateShort, formatDateVi } from "@/lib/utils";
import { ReportViewer } from "@/components/reports/report-viewer";
import { TournamentBadge } from "@/components/ui/tournament-badge";
import { formatFinalScore } from "@/lib/format-helpers";

export function ReportsPage() {
  const { reports, markReportSeen } = useApp();
  const [search, setSearch] = useState("");
  const [filterTournament, setFilterTournament] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest">("newest");
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const tournaments = useMemo(() => {
    const set = new Set<string>();
    reports.forEach((r) => set.add(r.match.tournamentName));
    return Array.from(set);
  }, [reports]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = reports.filter((r) => {
      if (filterTournament !== "all" && r.match.tournamentName !== filterTournament) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.content.toLowerCase().includes(q) ||
        r.match.player1.fullName.toLowerCase().includes(q) ||
        r.match.player2.fullName.toLowerCase().includes(q)
      );
    });
    list = list.sort((a, b) => {
      const ta = new Date(a.generatedAt).getTime();
      const tb = new Date(b.generatedAt).getTime();
      return sortBy === "newest" ? tb - ta : ta - tb;
    });
    return list;
  }, [reports, search, filterTournament, sortBy]);

  const handleCopy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div>
        <h1 className="flex items-center gap-2 text-base font-semibold text-slate-100">
          <FileText className="h-4 w-4 text-blue-400" />
          Lịch sử báo cáo
        </h1>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Tất cả báo cáo đã generate. Có thể copy, chỉnh sửa hoặc xem lại bất kỳ lúc nào.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên tay vợt, giải đấu, nội dung..."
            className="h-8 pl-8 text-[12px]"
          />
        </div>
        <Select value={filterTournament} onValueChange={setFilterTournament}>
          <SelectTrigger className="h-8 w-[200px] text-[12px]">
            <SelectValue placeholder="Lọc theo giải" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả giải đấu</SelectItem>
            {tournaments.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="h-8 w-[160px] text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Mới nhất trước</SelectItem>
            <SelectItem value="oldest">Cũ nhất trước</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-700 bg-slate-800/30 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-500">
            <Inbox className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-300">
              {reports.length === 0
                ? "Chưa có báo cáo nào"
                : "Không tìm thấy báo cáo phù hợp"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {reports.length === 0
                ? "Hãy thêm trận vào watchlist — báo cáo sẽ tự động sinh sau khi trận kết thúc."
                : "Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm."}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((report) => {
            const match = report.match;
            const preview = report.content
              .replace(/\*\*/g, "")
              .replace(/\n+/g, " ")
              .slice(0, 130);
            return (
              <Card
                key={report.id}
                className="group flex flex-col transition-colors hover:border-slate-700"
              >
                <CardContent className="flex flex-1 flex-col p-3">
                  <div className="flex items-center gap-1.5">
                    <TournamentBadge category={match.tournamentCategory} />
                    <Badge variant="slate" className="font-mono">
                      {match.round}
                    </Badge>
                    {report.isNew && (
                      <span className="ml-auto rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                        Mới
                      </span>
                    )}
                  </div>
                  <h3
                    className="mt-2 line-clamp-2 cursor-pointer text-[13px] font-semibold leading-snug text-slate-100 hover:text-blue-300"
                    onClick={() => {
                      markReportSeen(report.id);
                      setOpenMatchId(match.id);
                    }}
                  >
                    {report.title}
                  </h3>
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-slate-400">
                    {preview}…
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                    <span className="flex items-center gap-0.5">
                      <Calendar className="h-3 w-3" />
                      {formatDateShort(new Date(match.startTime))}
                    </span>
                    <span>•</span>
                    <span className="font-mono text-slate-400">
                      {formatFinalScore(match)}
                    </span>
                    <span>•</span>
                    <span className="truncate">{match.player1.name} vs {match.player2.name}</span>
                  </div>

                  <div className="mt-auto flex items-center gap-1.5 pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 flex-1 text-[11px]"
                      onClick={() => {
                        markReportSeen(report.id);
                        setOpenMatchId(match.id);
                      }}
                    >
                      <Edit3 className="h-3 w-3" />
                      Xem chi tiết
                    </Button>
                    <Button
                      size="sm"
                      variant={copiedId === report.id ? "success" : "default"}
                      className="h-7 px-2 text-[11px]"
                      onClick={() => handleCopy(report.id, report.content)}
                    >
                      {copiedId === report.id ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                  <div className="mt-1.5 text-[10px] text-slate-500">
                    Đã viết {formatDateVi(new Date(report.generatedAt))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ReportViewer matchId={openMatchId} onClose={() => setOpenMatchId(null)} />
    </div>
  );
}
