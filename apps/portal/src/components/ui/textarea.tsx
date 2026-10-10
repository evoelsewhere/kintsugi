// Textarea — the multi-line sibling of Input (DESIGN.md §4): same radius, border and
// focus treatment; monospace option for keys and config snippets.
import * as React from "react";
import { cn } from "../../lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

export function Textarea({ className, mono, ...props }: TextareaProps): React.JSX.Element {
  return (
    <textarea
      className={cn(
        "shadow-border min-h-20 w-full rounded-[var(--geist-radius)] bg-transparent px-3 py-2 text-[14px] text-text placeholder:text-text-muted",
        "focus-visible:outline-1 focus-visible:outline-[var(--ds-input-focus-color)] focus-visible:outline-auto focus-visible:shadow-none",
        "disabled:bg-recessed disabled:text-text-muted",
        mono === true && "font-mono text-[12px]",
        className,
      )}
      {...props}
    />
  );
}
