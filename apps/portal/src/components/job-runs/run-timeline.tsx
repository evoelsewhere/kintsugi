import { ArrowUpRight } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import type { JobRunView } from "@/lib/api/job-runs";
import { formatDuration } from "@/lib/format";
import { RUN_STATUS, styleOf } from "@/lib/status";
import { humanize, timelineOf } from "./run-events";

export function StepTimeline({
  steps,
  now,
  onSelect,
}: {
  steps: readonly JobRunView[];
  now: number;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const { rows } = timelineOf(steps, now);
  const seen = new Map<string, number>();
  return (
    <ol className="flex flex-col gap-1" aria-label="Execution timeline">
      {steps.map((step, index) => {
        const row = rows[index];
        const n = (seen.get(step.name) ?? 0) + 1;
        seen.set(step.name, n);
        const label = humanize(step.name) + (steps.filter((s) => s.name === step.name).length > 1 ? ` #${n}` : "");
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              className="grid w-full grid-cols-[minmax(0,1fr)_72px_16px] items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)] sm:grid-cols-[minmax(140px,1fr)_minmax(80px,1fr)_72px_16px]"
              aria-label={`Inspect ${label}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot tone={styleOf(RUN_STATUS, step.status).tone} className="size-2 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-text">{label}</span>
                  <span className="mt-0.5 block text-[11px] text-text-secondary">{styleOf(RUN_STATUS, step.status).label}</span>
                </span>
              </span>
              <span className="relative hidden h-1.5 overflow-hidden rounded-full bg-recessed sm:block">
                <span
                  className="absolute inset-y-0 rounded-full bg-text-secondary/60"
                  style={{ left: `${row?.offsetPct ?? 0}%`, width: `${row?.widthPct ?? 0}%` }}
                />
              </span>
              <span className="text-right text-[12px] tabular-nums text-text-secondary">
                {step.startedAt === undefined ? "—" : formatDuration(step.startedAt, step.finishedAt, now)}
              </span>
              <ArrowUpRight className="size-3.5 text-text-muted" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
