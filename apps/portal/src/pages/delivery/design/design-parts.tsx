// Building blocks of the Design view (ADR-0044, ADR-0045): the one conformance mark every screen
// uses, the command a member runs in their harness, and a copy button for it. The portal does
// not write designs; it shows where each stands and hands the work to the harness.

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { useToast } from "@/components/ui/toast";
import type { DesignState } from "@/lib/api/design";
import { STATE_LABEL, STATE_MEANING, STATE_TONE } from "./design-state";
import { cn } from "@/lib/utils";

/** A dot and a word. `detail` is the small text after it (a file count). */
export function ConformanceMark({ state, label, detail }: { state: DesignState; label?: string | undefined; detail?: string | undefined }): React.JSX.Element {
  if (state === "not-applicable") return <span className="text-text-muted" title={STATE_MEANING[state]}>—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text" title={STATE_MEANING[state]}>
      <StatusDot tone={STATE_TONE[state]} className={cn("size-2", state === "missing" && "bg-transparent ring-1 ring-inset ring-[var(--ds-text-muted)]")} />
      {label ?? STATE_LABEL[state]}
      {detail === undefined ? null : <span className="text-[11.5px] text-text-muted tabular-nums">{detail}</span>}
    </span>
  );
}

/** Copies `text` and says so; where the clipboard is not available it says what to copy by hand. */
export function CopyButton({ text, label, what, size = "small" }: { text: string; label: string; what: string; size?: "small" | "icon" }): React.JSX.Element {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${what} copied`, "Paste it in your harness.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(`Could not copy ${what.toLowerCase()}`, text);
    }
  }
  return (
    <Button size={size} variant="ghost" onClick={() => void copy()} title={text} aria-label={`${label}: ${text}`}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {size === "icon" ? null : label}
    </Button>
  );
}

/** `<set>@<version>` written in a design. */
export function TemplateRef({ value, current }: { value: string | undefined; current?: number }): React.JSX.Element {
  if (value === undefined) return <span className="text-text-muted">no template reference</span>;
  const version = Number(value.split("@")[1]);
  const behind = current !== undefined && Number.isFinite(version) && version < current;
  return (
    <span className="font-mono text-[11.5px] text-text-secondary">
      {value}
      {behind ? <span className="ml-1 font-sans text-[var(--ds-status-orange)]">· current is @{current}</span> : null}
    </span>
  );
}
