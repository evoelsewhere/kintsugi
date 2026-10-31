// The console navigator: selection filters events; disclosure loads nested jobs on demand.
import { Bot, ChevronDown, ChevronRight, FileCode2, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { Loaded } from "@/components/loaded";
import { StatusDot } from "@/components/ui/status-dot";
import { jobRunsApi, type JobRunView } from "@/lib/api/job-runs";
import { formatDuration } from "@/lib/format";
import { RUN_STATUS, styleOf } from "@/lib/status";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { describeProgress, humanize, stuckReason, type StepStats } from "./run-events";
import { PossiblyStuck } from "./run-timeline";

export interface StepsContext {
  projectId: string;
  now: number;
  stats: ReadonlyMap<string, StepStats>;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
  onChildren: (id: string, children: JobRunView[]) => void;
  version: string;
}
const icons = { agent: Bot, script: FileCode2, workflow: Workflow, stage: Workflow };
export function StepList({
  steps,
  context,
  depth = 0,
  expandAll = false,
}: {
  steps: readonly JobRunView[];
  context: StepsContext;
  depth?: number;
  expandAll?: boolean;
}): React.JSX.Element {
  const seen = new Map<string, number>();
  return (
    <ol className="flex flex-col gap-1" aria-label={depth === 0 ? "Run steps" : "Nested steps"}>
      {steps.map((step) => {
        const n = (seen.get(step.name) ?? 0) + 1;
        seen.set(step.name, n);
        const name = humanize(step.name) + (steps.filter((s) => s.name === step.name).length > 1 ? ` #${n}` : "");
        return <StepRow key={step.id} step={step} label={name} context={context} depth={depth} expandAll={expandAll} />;
      })}
    </ol>
  );
}
function StepRow({
  step,
  label,
  context,
  depth,
  expandAll,
}: {
  step: JobRunView;
  label: string;
  context: StepsContext;
  depth: number;
  expandAll: boolean;
}): React.JSX.Element {
  const nested = step.kind === "workflow" || step.kind === "stage";
  const [open, setOpen] = useState(step.status === "running" || step.status === "failed");
  const selected = context.selected === step.id;
  const expanded = open || expandAll || (nested && selected);
  const stats = context.stats.get(step.id);
  const stuck = step.status === "running" ? stuckReason(stats, context.now) : undefined;
  const Icon = icons[step.kind];
  return (
    <li className="min-w-0">
      <div className={cn("flex items-start rounded-lg", selected ? "bg-hover shadow-border" : "hover:bg-hover")}>
        {nested ? (
          <button
            type="button"
            aria-expanded={expanded}
            disabled={selected || expandAll}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
            onClick={() => setOpen(!open)}
            className="mt-3 rounded p-1 text-text-secondary focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => {
            context.onSelect(selected ? undefined : step.id);
            if (nested) setOpen(true);
          }}
          className="min-w-0 flex-1 rounded-lg p-2 text-left focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
        >
          <span className="flex min-w-0 items-center gap-2">
            <StatusDot tone={styleOf(RUN_STATUS, step.status).tone} className="size-2 shrink-0" />
            <span className="min-w-0 flex-1 break-words text-[13px] font-medium leading-5 text-text">{label}</span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 pl-4 text-[11px] text-text-secondary">
            <Icon className="size-3" />
            {step.kind}
            <span>·</span>
            {styleOf(RUN_STATUS, step.status).label}
            <span className="ml-auto tabular-nums">{formatDuration(step.startedAt, step.finishedAt, context.now)}</span>
          </span>
          {step.failureReason === undefined ? null : (
            <span className="mt-1 block truncate pl-4 text-[11px] text-text-secondary" title={step.failureReason}>
              {step.failureReason}
            </span>
          )}
          {step.status === "running" && stats?.progress !== undefined ? (
            <span className="mt-1 block pl-4 text-[11px] text-text-secondary">{describeProgress(stats.progress)}</span>
          ) : null}
          {step.status === "running" && stuck !== undefined ? (
            <span className="mt-1 block pl-4">
              <PossiblyStuck reason={stuck} />
            </span>
          ) : null}
        </button>
      </div>
      {nested && expanded ? <StepChildren step={step} context={context} depth={depth + 1} expandAll={expandAll || selected} /> : null}
    </li>
  );
}
function StepChildren({
  step,
  context,
  depth,
  expandAll,
}: {
  step: JobRunView;
  context: StepsContext;
  depth: number;
  expandAll: boolean;
}): React.JSX.Element {
  const detail = useLoader(`console-children/${context.projectId}/${step.id}/${context.version}`, () =>
    jobRunsApi.get(context.projectId, step.id),
  );
  const onChildren = context.onChildren;
  useEffect(() => {
    if (detail.data !== undefined) onChildren(step.id, detail.data.steps);
  }, [detail.data, step.id, onChildren]);
  return (
    <div className="ml-3 pl-2 shadow-[inset_1px_0_0_var(--ds-background-300)]">
      <Loaded loader={detail} rows={1}>
        {(data) =>
          data.steps.length === 0 ? (
            <p className="p-2 text-[12px] text-text-secondary">No nested steps yet.</p>
          ) : (
            <StepList steps={data.steps} context={context} depth={depth} expandAll={expandAll} />
          )
        }
      </Loaded>
    </div>
  );
}
