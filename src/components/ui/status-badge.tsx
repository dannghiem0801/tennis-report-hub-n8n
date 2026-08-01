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

export function WatchlistStatusBadge({ status }: { status: WatchlistStatus }) {
  switch (status) {
    case "pending":
      return <Badge variant="slate">Đang chờ</Badge>;
    case "generating":
      return (
        <Badge variant="warning" className="uppercase tracking-wide">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
          Đang viết
        </Badge>
      );
    case "completed":
      return <Badge variant="success">Đã viết</Badge>;
    case "failed":
      return <Badge variant="destructive">Lỗi</Badge>;
  }
}
