import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/20 text-blue-300",
        secondary: "border-transparent bg-slate-700 text-slate-200",
        destructive: "border-transparent bg-red-500/15 text-red-300",
        success: "border-transparent bg-emerald-500/15 text-emerald-300",
        warning: "border-transparent bg-amber-500/15 text-amber-300",
        outline: "border-slate-700 text-slate-300",
        slate: "border-transparent bg-slate-700/50 text-slate-300",
        blue: "border-transparent bg-blue-500/15 text-blue-300",
        purple: "border-transparent bg-purple-500/15 text-purple-300",
        pink: "border-transparent bg-pink-500/15 text-pink-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
