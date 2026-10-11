// Status badges — a neutral pill with a status dot and a label (DESIGN.md: color only in the
// dot). The tone and label come from lib/status.ts, so a status reads the same on every page.

import { Badge } from "@/components/ui/badge";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { GATE_STATUS, RUN_STATUS, styleOf, SYNC_STATUS, WORKER_STATE, WRITE_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";

export function StatusBadge({ tone, label, title, className }: { tone: StatusTone; label: string; title?: string; className?: string }): React.JSX.Element {
  return (
    <Badge className={cn("shrink-0 whitespace-nowrap", className)} title={title}>
      <StatusDot tone={tone} className="size-2" />
      {label}
    </Badge>
  );
}

export function RunStatusBadge({ status, cancelling, title }: { status: string; cancelling?: boolean; title?: string }): React.JSX.Element {
  const style = styleOf(RUN_STATUS, status);
  return <StatusBadge tone={cancelling === true ? "orange" : style.tone} label={cancelling === true ? "Cancelling…" : style.label} {...(title === undefined ? {} : { title })} />;
}

export function WriteStatusBadge({ status, title }: { status: string; title?: string }): React.JSX.Element {
  const style = styleOf(WRITE_STATUS, status);
  return <StatusBadge tone={style.tone} label={style.label} {...(title === undefined ? {} : { title })} />;
}

export function SyncStatusBadge({ status, title }: { status: string; title?: string }): React.JSX.Element {
  const style = styleOf(SYNC_STATUS, status);
  return <StatusBadge tone={style.tone} label={style.label} {...(title === undefined ? {} : { title })} />;
}

export function GateStatusBadge({ status, title }: { status: string; title?: string }): React.JSX.Element {
  const style = styleOf(GATE_STATUS, status);
  return <StatusBadge tone={style.tone} label={style.label} {...(title === undefined ? {} : { title })} />;
}

export function WorkerStateBadge({ state, title }: { state: string; title?: string }): React.JSX.Element {
  const style = styleOf(WORKER_STATE, state);
  return <StatusBadge tone={style.tone} label={style.label} {...(title === undefined ? {} : { title })} />;
}
