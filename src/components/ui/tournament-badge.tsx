import { cn } from "@/lib/utils";
import type { TournamentCategory } from "@/types";

const CATEGORY_COLORS: Record<TournamentCategory, string> = {
  "Grand Slam": "bg-amber-500/15 text-amber-300 border-amber-500/20",
  "ATP Masters 1000": "bg-blue-500/15 text-blue-300 border-blue-500/20",
  "ATP 500": "bg-sky-500/15 text-sky-300 border-sky-500/20",
  "ATP 250": "bg-cyan-500/15 text-cyan-300 border-cyan-500/20",
  "WTA 1000": "bg-pink-500/15 text-pink-300 border-pink-500/20",
  "WTA 500": "bg-rose-500/15 text-rose-300 border-rose-500/20",
  "WTA 250": "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/20",
  "Challenger": "bg-purple-500/15 text-purple-300 border-purple-500/20",
  "ITF": "bg-slate-500/15 text-slate-300 border-slate-500/20",
};

export function TournamentBadge({
  category,
  className,
}: {
  category: TournamentCategory;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        CATEGORY_COLORS[category],
        className
      )}
    >
      {category}
    </span>
  );
}
