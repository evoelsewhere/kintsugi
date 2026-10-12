// Text written by an agent, shown inline: `code spans` become code, everything else stays
// plain text (never HTML). For table cells and short fields of the result views.

import { useState } from "react";
import { cn } from "@/lib/utils";

export function InlineText({ text, className }: { text: string | undefined; className?: string }): React.JSX.Element | null {
  if (text === undefined || text === "") return null;
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={index} className="rounded-[4px] bg-hover px-1 py-px font-mono text-[0.92em] text-text">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </span>
  );
}

/** A `file:line` citation as a compact code chip. */
export function CitationChip({ path, from, to, className }: { path: string; from: number; to: number; className?: string }): React.JSX.Element {
  const range = `${from}${to === from ? "" : `-${to}`}`;
  return (
    <code className={cn("inline-block max-w-full truncate rounded-[4px] bg-hover px-1.5 py-px font-mono text-[11px] text-text-secondary", className)} title={`${path}:${range}`}>
      {path}:{range}
    </code>
  );
}

/** A long paragraph clamped to a few lines, with Show more / Show less. */
export function ClampedText({ text, lines = 5 }: { text: string; lines?: number }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 110;
  return (
    <div className="text-[13px] leading-6 text-text-secondary">
      <p className={cn(!open && long && "overflow-hidden")} style={!open && long ? { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical" } : undefined}>
        <InlineText text={text} />
      </p>
      {long ? (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-[12px] text-accent hover:underline">
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
