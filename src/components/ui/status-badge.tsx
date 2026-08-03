import { Download, Cog, Globe, Sparkles, CheckCircle2, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MatchStatus, WatchlistStatus } from "@/types";
import { Badge } from "./badge";

export function StatusBadge({ status, className }: { status: MatchStatus; className?: string }) {
  if (status === "live") {
    return (
      <Badge variant="destructive" className={cn("uppercase tracking-wide", className)}>
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
        LIVE
      </Badge>
    );
  }
  if (status === "completed") {
    return (
      <Badge variant="success" className={cn("uppercase tracking-wide", className)}>
        ✓ Hoàn thành
      </Badge>
    );
  }
  return (
    <Badge variant="slate" className={cn("uppercase tracking-wide", className)}>
      Sắp diễn ra
    </Badge>
  );
}

/**
 * Watchlist status badge for the report-generation pipeline. Each state
 * has a distinctive icon + color so the user can see at a glance which
 * step the pipeline is on.
 *
 *   pending          → slate, clock — "chờ match kết thúc"
 *   fetching-pbp     → blue,  download — "lấy point-by-point từ API"
 *   building-context → blue,  cog — "chuẩn bị dữ liệu cho LLM"
 *   web-searching    → cyan,  globe — "tìm context bổ sung"
 *   consolidating    → purple, sparkles — "LLM viết báo cáo"
 *   completed        → green, check — "xong"
 *   failed           → red,   x — "lỗi" (hover for errorMessage)
 */
export function WatchlistStatusBadge({
  status,
  errorMessage,
  className,
}: {
  status: WatchlistStatus;
  errorMessage?: string;
  className?: string;
}) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="slate" className={cn("gap-1", className)}>
          <Clock className="h-3 w-3" />
          Chờ match
        </Badge>
      );
    case "fetching-pbp":
      return (
        <Badge
          variant="outline"
          className={cn(
            "gap-1 border-blue-700/50 bg-blue-900/20 text-blue-300",
            className,
          )}
        >
          <Download className="h-3 w-3 animate-pulse" />
          PBP
        </Badge>
      );
    case "building-context":
      return (
        <Badge
          variant="outline"
          className={cn(
            "gap-1 border-blue-700/50 bg-blue-900/20 text-blue-300",
            className,
          )}
        >
          <Cog className="h-3 w-3 animate-spin" />
          Build
        </Badge>
      );
    case "web-searching":
      return (
        <Badge
          variant="outline"
          className={cn(
            "gap-1 border-cyan-700/50 bg-cyan-900/20 text-cyan-300",
            className,
          )}
        >
          <Globe className="h-3 w-3 animate-pulse" />
          Search
        </Badge>
      );
    case "consolidating":
      return (
        <Badge
          variant="outline"
          className={cn(
            "gap-1 border-purple-700/50 bg-purple-900/20 text-purple-300",
            className,
          )}
        >
          <Sparkles className="h-3 w-3 animate-pulse" />
          LLM
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="success" className={cn("gap-1", className)}>
          <CheckCircle2 className="h-3 w-3" />
          Xong
        </Badge>
      );
    case "failed":
      return (
        <Badge
          variant="destructive"
          className={cn("gap-1", className)}
          title={errorMessage ?? "Có lỗi xảy ra"}
        >
          <XCircle className="h-3 w-3" />
          Lỗi
        </Badge>
      );
  }
}
