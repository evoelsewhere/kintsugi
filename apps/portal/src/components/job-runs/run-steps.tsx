// The steps of a run as a selectable timeline: a row per step (a workflow or stage step opens to
// its own child steps, loaded when opened) with its status, how long it took, a bar on the run's
// time axis, what it is doing now and the tools it has used. Selecting a step filters the log
// to it; the same row selects again to clear.

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

export function StepList({ steps, context, depth = 0 }: { steps: readonly JobRunView[]; context: StepsContext; depth?: number }): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-1">
      {steps.map((step) => (
        <StepRow key={step.id} step={step} context={context} depth={depth} />
      ))}
    </ul>
  );
}

function StepRow({ step, context, depth }: { step: JobRunView; context: StepsContext; depth: number }): React.JSX.Element {
  const nested = step.kind === "workflow" || step.kind === "stage";
  const [open, setOpen] = useState(step.status === "running");
  const Icon = KIND_ICON[step.kind];
  const stats = context.stats.get(step.id);
  const active = step.status === "running" || step.status === "queued";
  const selected = context.selected === step.id;
  const start = step.startedAt === undefined ? undefined : new Date(step.startedAt).getTime();
  const end = step.finishedAt === undefined ? context.now : new Date(step.finishedAt).getTime();
  const left = start === undefined ? 0 : Math.min(((start - context.origin) / context.span) * 100, 99);
  const width = start === undefined ? 0 : Math.max(((end - start) / context.span) * 100, 1.2);
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
          <span className="flex items-center gap-2">
            <StatusDot tone={styleOf(RUN_STATUS, step.status).tone} className={cn("size-2", active && "animate-pulse")} />
            <Icon className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{step.name}</span>
            <span className="shrink-0 text-[11.5px] text-text-secondary tabular-nums">{start === undefined ? styleOf(RUN_STATUS, step.status).label : formatDuration(step.startedAt, step.finishedAt, context.now)}</span>
          </span>
          <span className="relative block h-1.5 rounded-full bg-hover">
            {start === undefined ? null : (
              <span
                className={cn("absolute inset-y-0 rounded-full", active && "animate-pulse")}
                style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, backgroundColor: RUN_COLOR[step.status] ?? "var(--ds-text-muted)" }}
              />
            )}
          </span>
          {step.failureReason === undefined ? null : <span className="break-words text-[12px] text-[var(--ds-status-red)]">{step.failureReason}</span>}
          {active && stats?.progress !== undefined ? (
            <span className="flex items-center gap-1.5 truncate text-[11px] text-text-secondary" title={stats.last}>
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--ds-status-blue)]" />
              <span className="tabular-nums">{describeProgress(stats.progress)}</span>
              {stats.lastAt === undefined ? null : <span className="text-text-muted">· last tool call {formatRelative(stats.lastAt, context.now)}</span>}
            </span>
          ) : null}
          {active && stats?.last !== undefined ? (
            <span className="truncate font-mono text-[11px] text-text-muted" title={stats.last}>
              {stats.last}
            </span>
          ) : null}
          {tools.length === 0 && step.agent === undefined && step.scriptHash === undefined ? null : (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted">
              {step.agent === undefined ? null : <span>{step.agent}</span>}
              {step.scriptHash === undefined ? null : <span className="font-mono">sha256 {step.scriptHash.slice(0, 10)}</span>}
              {tools.map(([tool, count]) => (
                <span key={tool} className="tabular-nums">
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
