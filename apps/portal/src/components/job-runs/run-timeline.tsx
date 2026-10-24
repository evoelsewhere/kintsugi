// The steps of a run on one time axis (the idiom of the span bars in Governance → Telemetry): parallel steps overlap, the
// slow one is the long bar, and a step still running reaches to now. Shown once two steps have started.

import type { JobRunView } from "@/lib/api/job-runs";
import { formatMillis } from "@/lib/telemetry";
import { RUN_STATUS, styleOf } from "@/lib/status";
import { cn } from "@/lib/utils";
import { humanize, timelineOf } from "./run-events";

const COLOR: Record<string, string> = { succeeded: "green", failed: "red", cancelled: "orange" };

export function StepTimeline({ steps, now }: { steps: readonly JobRunView[]; now: number }): React.JSX.Element | null {
  const { rows, totalMs, started } = timelineOf(steps, now);
  if (started < 2) return null;
  return (
    <div className="flex flex-col gap-1" role="img" aria-label={`Timeline of ${started} steps over ${formatMillis(totalMs)}`}>
      <ul className="flex flex-col gap-1">
        {rows
          .filter((row) => row.offsetPct !== undefined)
          .map((row) => (
            <li key={row.id} className="grid grid-cols-[minmax(80px,0.4fr)_minmax(0,1fr)_56px] items-center gap-3 text-[11.5px]" title={`${humanize(row.name)} · ${styleOf(RUN_STATUS, row.status).label}`}>
              <span className="truncate text-text-secondary">{humanize(row.name)}</span>
              <span className="relative h-1.5 rounded-full bg-hover">
                <span
                  className={cn("absolute inset-y-0 rounded-full", row.status === "running" && "run-bar-active")}
                  style={{ left: `${row.offsetPct}%`, width: `${row.widthPct}%`, backgroundColor: `var(--ds-status-${COLOR[row.status] ?? "blue"})` }}
                />
              </span>
              <span className="text-right tabular-nums text-text-muted">{formatMillis(row.durationMs)}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
