// The steps of a run as a selectable timeline: a row per step (a workflow or stage step opens to
// its own child steps, loaded when opened) with its status, how long it took and its place on the
// run's time axis — the track column shared by every row, so bars line up and steps that ran at the
// same time can be seen at a glance. Steps that share a name are numbered so they can be told
// apart. Selecting a step filters the log to it; the same row selects again to clear.

import { Bot, ChevronDown, ChevronRight, FileCode2, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { Loaded } from "@/components/loaded";
import { RUN_COLOR } from "@/components/results/status-colors";
import { StatusDot } from "@/components/ui/status-dot";
import { jobRunsApi, type JobRunView } from "@/lib/api/job-runs";
import { formatDuration, formatRelative } from "@/lib/format";
import { RUN_STATUS, styleOf } from "@/lib/status";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { describeProgress, type StepStats } from "./run-events";

export interface StepsContext {
  projectId: string;
  /** The run's start and the length of its time axis, in milliseconds since the epoch / ms. */
  origin: number;
  span: number;
  now: number;
  stats: ReadonlyMap<string, StepStats>;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
  /** Reports the child steps a workflow step has loaded, so a selection covers them. */
  onChildren: (id: string, children: string[]) => void;
  /** Changes when the run's status does, so open workflow steps reload. */
  version: string;
}

const KIND_ICON = { agent: Bot, workflow: Workflow, script: FileCode2, stage: Workflow } as const;

/** "#2" for the steps that share a name with a sibling, so repeated agents can be told apart. */
function instancesOf(steps: readonly JobRunView[]): Map<string, string> {
  const totals = new Map<string, number>();
  for (const step of steps) totals.set(step.name, (totals.get(step.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const marks = new Map<string, string>();
  for (const step of steps) {
    const n = (seen.get(step.name) ?? 0) + 1;
    seen.set(step.name, n);
    if ((totals.get(step.name) ?? 0) > 1) marks.set(step.id, `#${n}`);
  }
  return marks;
}

/** "82m" as "1h 22m" — the end label of the run's time axis. */
const formatSpan = (ms: number): string => {
  const seconds = Math.max(Math.round(ms / 1000), 0);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export function StepList({ steps, context, depth = 0 }: { steps: readonly JobRunView[]; context: StepsContext; depth?: number }): React.JSX.Element {
  const marks = instancesOf(steps);
  return (
    <div className="flex flex-col gap-1">
      {depth === 0 ? <TimeAxis span={context.span} /> : null}
      <ul className="flex flex-col gap-1">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} mark={marks.get(step.id)} context={context} depth={depth} />
        ))}
      </ul>
    </div>
  );
}

/** Labels the run's time axis over the track column every row shares. The grid mirrors a row's. */
function TimeAxis({ span }: { span: number }): React.JSX.Element {
  return (
    <div className="flex items-start gap-1 pr-2" aria-hidden>
      <span className="ml-1.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 py-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_92px] items-center gap-x-2">
          <span className="text-[10px] text-text-muted">on the run&apos;s time axis</span>
          <span className="w-16" />
          <span className="flex justify-between text-[10px] tabular-nums text-text-muted">
            <span>0s</span>
            <span>{formatSpan(span)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function StepRow({ step, mark, context, depth }: { step: JobRunView; mark: string | undefined; context: StepsContext; depth: number }): React.JSX.Element {
  const nested = step.kind === "workflow" || step.kind === "stage";
  const [open, setOpen] = useState(step.status === "running");
  const Icon = KIND_ICON[step.kind];
  const stats = context.stats.get(step.id);
  const active = step.status === "running" || step.status === "queued";
  const selected = context.selected === step.id;
  const start = step.startedAt === undefined ? undefined : new Date(step.startedAt).getTime();
  const end = step.finishedAt === undefined ? context.now : new Date(step.finishedAt).getTime();
  const span = context.span > 0 ? context.span : 1;
  const left = start === undefined ? 0 : Math.min(((start - context.origin) / span) * 100, 99);
  const width = start === undefined ? 0 : Math.max(((end - start) / span) * 100, 1.2);
  const tools = Object.entries(stats?.tools ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <li className="flex flex-col gap-1" style={{ marginLeft: depth === 0 ? 0 : 12 }}>
      <div className={cn("flex items-start gap-1 rounded-[10px] pr-2", selected ? "bg-hover [box-shadow:inset_0_0_0_1px_var(--color-text)]" : "hover:bg-hover")}>
        {nested ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? `Hide the steps of ${step.name}` : `Show the steps of ${step.name}`}
            onClick={() => setOpen(!open)}
            className="mt-2 ml-1.5 rounded-[var(--geist-radius)] text-text-muted hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="ml-1.5 size-3.5 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => context.onSelect(selected ? undefined : step.id)}
          className="flex min-w-0 flex-1 flex-col gap-1 py-1.5 text-left focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
          title="Show only this step in the log"
        >
          <span className="grid grid-cols-[minmax(0,1fr)_auto_92px] items-center gap-x-2">
            <span className="flex min-w-0 items-center gap-2">
              <StatusDot tone={styleOf(RUN_STATUS, step.status).tone} className={cn("size-2", active && "animate-pulse")} />
              <Icon className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text" title={step.name}>
                {step.name}
                {mark === undefined ? null : <span className="ml-1 font-mono text-[11px] font-normal text-text-muted">{mark}</span>}
              </span>
            </span>
            <span className="w-16 text-right text-[11.5px] tabular-nums text-text-secondary">
              {start === undefined ? styleOf(RUN_STATUS, step.status).label : formatDuration(step.startedAt, step.finishedAt, context.now)}
            </span>
            <span className="relative block h-1 rounded-full bg-hover" aria-hidden>
              {start === undefined ? null : (
                <span
                  className={cn("absolute inset-y-0 rounded-full", active && "animate-pulse")}
                  style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, backgroundColor: RUN_COLOR[step.status] ?? "var(--ds-text-muted)" }}
                />
              )}
            </span>
          </span>
          {step.failureReason === undefined ? null : (
            <span className="flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-[var(--ds-status-red)]" title={step.failureReason}>
              <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-[var(--ds-status-red)]" aria-hidden />
              <span className="line-clamp-2 break-words">{step.failureReason}</span>
            </span>
          )}
          {active && stats?.progress !== undefined ? (
            <span className="flex items-center gap-1.5 text-[11px] text-text-secondary" title={describeProgress(stats.progress)}>
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--ds-status-blue)]" aria-hidden />
              <span className="truncate tabular-nums">{describeProgress(stats.progress)}</span>
            </span>
          ) : null}
          {active && stats?.last !== undefined ? (
            <span className="flex items-baseline gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate font-mono text-text-muted" title={stats.last}>
                {stats.last}
              </span>
              {stats.lastAt === undefined ? null : <span className="shrink-0 tabular-nums text-text-muted">{formatRelative(stats.lastAt, context.now)}</span>}
            </span>
          ) : null}
          {tools.length === 0 && step.agent === undefined && step.scriptHash === undefined ? null : (
            <span className="flex flex-wrap items-center gap-1 text-[11px] text-text-muted">
              {step.agent === undefined ? null : <span className="rounded-full bg-hover px-1.5 py-0.5">{step.agent}</span>}
              {step.scriptHash === undefined ? null : <span className="rounded-full bg-hover px-1.5 py-0.5 font-mono">sha256 {step.scriptHash.slice(0, 10)}</span>}
              {tools.map(([tool, count]) => (
                <span key={tool} className="rounded-full bg-hover px-1.5 py-0.5 tabular-nums">
                  {tool} <span className="text-text-secondary">{count}</span>
                </span>
              ))}
              {stats === undefined || stats.blocked === 0 ? null : <span className="text-[var(--ds-status-red)]">{stats.blocked} blocked</span>}
            </span>
          )}
        </button>
      </div>
      {open && nested ? <StepChildren stepId={step.id} context={context} depth={depth + 1} version={`${context.version}/${step.status}`} /> : null}
    </li>
  );
}

function StepChildren({ stepId, context, depth, version }: { stepId: string; context: StepsContext; depth: number; version: string }): React.JSX.Element {
  const { projectId, onChildren } = context;
  const children = useLoader(`step/${projectId}/${stepId}/${version}`, () => jobRunsApi.get(projectId, stepId));
  const ids = children.data?.steps.map((step) => step.id).join(",");
  useEffect(() => {
    if (ids !== undefined) onChildren(stepId, ids === "" ? [] : ids.split(","));
  }, [ids, stepId, onChildren]);
  return (
    <div className="ml-3 border-l border-black/10 pl-2 dark:border-white/10">
      <Loaded loader={children} rows={1}>
        {(detail) => (detail.steps.length === 0 ? <p className="py-1 text-[12px] text-text-muted">No child steps recorded yet.</p> : <StepList steps={detail.steps} context={context} depth={depth} />)}
      </Loaded>
    </div>
  );
}
