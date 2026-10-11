// Badge — DESIGN.md §4: pill shapes (9999px) are for badges and tags only.
// Neutral surface; colored meaning is carried by StatusDot, not by fills.
import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement>;

export function Badge({ className, ...props }: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--geist-pill-radius)] bg-hover px-2 py-0.5 text-[12px] leading-4 text-text-secondary",
        className,
      )}
      {...props}
    />
  );
}
