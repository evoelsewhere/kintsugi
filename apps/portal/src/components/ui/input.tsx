// Input — DESIGN.md §4: height 40px (form tokens), 14px/400, radius 6px,
// shadow-as-border, focus = 1px auto outline #005FCC with the shadow removed.
import * as React from "react";
import { cn } from "../../lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps): React.JSX.Element {
  return (
    <input
      className={cn(
        "shadow-border h-[var(--geist-form-height)] w-full rounded-[var(--geist-radius)] bg-transparent px-3 text-[14px] text-text placeholder:text-text-muted",
        "focus-visible:outline-1 focus-visible:outline-[var(--ds-input-focus-color)] focus-visible:outline-auto focus-visible:shadow-none",
        "disabled:bg-recessed disabled:text-text-muted",
        className,
      )}
      {...props}
    />
  );
}
