// Input — DESIGN.md §4: height 40px (form tokens), 14px/400, radius 6px,
// shadow-as-border, focus = 1px auto outline #005FCC with the shadow removed.
import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** `small` (32px, 13px text) for the filters of a table or a toolbar. */
  size?: "default" | "small";
}

export function Input({ className, size = "default", ...props }: InputProps): React.JSX.Element {
  return (
    <input
      className={cn(
        "shadow-border w-full rounded-[var(--geist-radius)] bg-transparent text-text placeholder:text-text-muted",
        size === "small" ? "h-[var(--geist-form-small-height)] px-2.5 text-[13px]" : "h-[var(--geist-form-height)] px-3 text-[14px]",
        "focus-visible:outline-1 focus-visible:outline-[var(--ds-input-focus-color)] focus-visible:outline-auto focus-visible:shadow-none",
        "disabled:bg-recessed disabled:text-text-muted",
        className,
      )}
      {...props}
    />
  );
}
