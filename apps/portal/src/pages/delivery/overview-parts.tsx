// Building blocks of the Delivery overview: the project's headline figures, the run activity of
// the last two weeks, what needs attention, the most recent runs and a mini bar chart of one
// stage's runs. Everything is computed from the project's recent run list.

import { CheckCircle2, CircleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { StackedColumns } from "@/components/results/charts";
import { RunStatusBadge } from "@/components/status-badges";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { JobRunView, StageView } from "@/lib/api/job-runs";
import type { ApplicationView } from "@/lib/api/projects";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { deliveryLink } from "@/lib/links";
import { isActiveStatus, RUN_STATUS, styleOf } from "@/lib/status";
import { stageLabel } from "@/lib/stages";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { type PipelineHealth, pipelineHealth } from "./pipeline-health";
import { Kpi, KpiRow, Section } from "./results/results-parts";

const STATUS_COLOR: Record<string, string> = {
  succeeded: CHART_COLOR.green,
  failed: CHART_COLOR.red,
  running: CHART_COLOR.blue,
  queued: CHART_COLOR.blue,
  cancelled: CHART_COLOR.orange,
};

const stageRuns = (runs: readonly JobRunView[]): JobRunView[] => runs.filter((run) => run.kind === "stage");

const durationMs = (run: Pick<JobRunView, "startedAt" | "finishedAt">): number | undefined =>
  run.startedAt === undefined || run.finishedAt === undefined ? undefined : Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime());

export function ProjectKpis({ applications, stages, runs }: { applications: readonly ApplicationView[]; stages: readonly StageView[]; runs: readonly JobRunView[] }): React.JSX.Element {
  const top = stageRuns(runs);
  const health = pipelineHealth(applications, stages, runs);
  const active = top.filter((run) => isActiveStatus(run.status));
  const finished = top.filter((run) => run.status === "succeeded" || run.status === "failed");
  const succeeded = finished.filter((run) => run.status === "succeeded").length;
  const activeApps = new Set(active.map((run) => run.applicationId)).size;
  const newest = top[0];
  return (
    <KpiRow>
      <Kpi label="Applications" value={applications.length} hint={activeApps === 0 ? "no active run" : `${activeApps} with an active run`} />
      <Kpi label="Stages completed" value={undefined} display={`${health.done}/${health.total}`} hint="latest run succeeded" tone={health.total > 0 && health.done === health.total ? "green" : undefined} />
      <Kpi label="Active runs" value={active.length} hint={active.length === 0 ? "nothing running" : "refreshing live"} tone={active.length > 0 ? "blue" : undefined} />
      <Kpi label="Success rate" value={undefined} display={finished.length === 0 ? "—" : `${Math.round((succeeded / finished.length) * 100)}%`} hint={`of ${finished.length} finished runs`} />
      <Kpi label="Needs attention" value={health.attention.length} hint={health.attention.length === 0 ? "latest runs are healthy" : "latest run failed or stopped"} tone={health.attention.length > 0 ? "red" : "green"} />
      <Kpi label="Last activity" value={undefined} display={newest === undefined ? "—" : formatRelative(newest.createdAt)} hint={newest === undefined ? "no run yet" : `${stageLabel(newest.name)} · ${styleOf(RUN_STATUS, newest.status).label.toLowerCase()}`} />
    </KpiRow>
  );
}

const DAYS = 14;

/** Runs per day over the last two weeks, split by outcome. */
export function ActivityChart({ runs }: { runs: readonly JobRunView[] }): React.JSX.Element {
  const now = useNow(false);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: DAYS }, (_, index) => new Date(today.getTime() - (DAYS - 1 - index) * 86400000));
  const top = stageRuns(runs);
  const outcomes: Array<{ label: string; color: string; match: (run: JobRunView) => boolean }> = [
    { label: "Succeeded", color: CHART_COLOR.green, match: (run) => run.status === "succeeded" },
    { label: "Failed", color: CHART_COLOR.red, match: (run) => run.status === "failed" },
    { label: "Cancelled", color: CHART_COLOR.orange, match: (run) => run.status === "cancelled" },
    { label: "Active", color: CHART_COLOR.blue, match: (run) => isActiveStatus(run.status) },
  ];
  const columns = days.map((day) => {
    const inDay = top.filter((run) => new Date(run.createdAt).getTime() >= day.getTime() && new Date(run.createdAt).getTime() < day.getTime() + 86400000);
    return {
      label: String(day.getDate()),
      title: `${day.toLocaleDateString()}: ${inDay.length} runs`,
      segments: outcomes.map((outcome) => ({ label: outcome.label, color: outcome.color, value: inDay.filter(outcome.match).length })),
    };
  });
  const inRange = columns.reduce((sum, column) => sum + column.segments.reduce((total, segment) => total + segment.value, 0), 0);
  return (
    <Section title="Run activity" description={`Stage runs per day over the last ${DAYS} days · ${inRange} in this period.`}>
      {inRange === 0 ? <p className="py-6 text-center text-[12px] text-text-muted">No stage run in the last {DAYS} days.</p> : <StackedColumns columns={columns} legend={outcomes} />}
    </Section>
  );
}

/** The slots whose latest run failed or stopped, with the reason, each a link to its run. */
export function NeedsAttention({ projectId, health, hasRuns }: { projectId: string; health: PipelineHealth; hasRuns: boolean }): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <Section title="Needs attention" description="Stages whose latest run did not succeed.">
      {health.attention.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-text-secondary">
          <CheckCircle2 className="size-4 shrink-0 text-[var(--ds-status-green)]" strokeWidth={1.75} />
          {hasRuns ? "Every stage's latest run is healthy or still going." : "Nothing has run yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {health.attention.slice(0, 5).map(({ application, stage, run }) => (
            <li key={`${application.id}/${stage.id}`}>
              <button
                type="button"
                onClick={() => navigate(deliveryLink({ projectId, applicationId: application.id, stage: stage.id, runId: run.id }))}
                className="-mx-2 flex w-[calc(100%+16px)] flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
              >
                <span className="flex items-center gap-2 text-[13px] text-text">
                  <CircleAlert className="size-4 shrink-0 text-[var(--ds-status-red)]" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate">
                    {application.name} · {stageLabel(stage.id)}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-muted" title={formatDateTime(run.createdAt)}>
                    {styleOf(RUN_STATUS, run.status).label} {formatRelative(run.finishedAt ?? run.createdAt)}
                  </span>
                </span>
                {run.failureReason === undefined ? null : <span className="line-clamp-2 pl-6 text-[12px] text-text-secondary">{run.failureReason}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The newest stage runs across the applications; a row opens the run. */
export function RecentRuns({ projectId, applications, runs }: { projectId: string; applications: readonly ApplicationView[]; runs: readonly JobRunView[] }): React.JSX.Element {
  const navigate = useNavigate();
  const nameOf = (id: string | undefined): string => applications.find((application) => application.id === id)?.name ?? id ?? "—";
  const rows = stageRuns(runs).slice(0, 30);
  const columns: Column<JobRunView>[] = [
    { id: "stage", header: "Stage", cell: (run) => <span className="whitespace-nowrap text-text">{stageLabel(run.name)}</span>, sort: (run) => run.name },
    { id: "application", header: "Application", cell: (run) => <span className="text-text-secondary">{nameOf(run.applicationId)}</span>, sort: (run) => nameOf(run.applicationId) },
    { id: "status", header: "Status", cell: (run) => <RunStatusBadge status={run.status} />, sort: (run) => run.status },
    { id: "started", header: "Started", cell: (run) => <span title={formatDateTime(run.createdAt)}>{formatRelative(run.createdAt)}</span>, sort: (run) => run.createdAt },
    { id: "duration", header: "Duration", cell: (run) => <span className="tabular-nums">{run.startedAt === undefined ? "—" : formatDuration(run.startedAt, run.finishedAt)}</span>, sort: (run) => durationMs(run), align: "right" },
    { id: "files", header: "Output files", cell: (run) => (run.outputSummary?.files === undefined ? "—" : String(run.outputSummary.files)), sort: (run) => run.outputSummary?.files, align: "right" },
    { id: "note", header: "Note", cell: (run) => <span className="line-clamp-1 text-text-secondary" title={run.failureReason}>{run.failureReason ?? ""}</span> },
  ];
  return (
    <Section title="Recent runs" description="The newest stage runs of every application in the project; open one for its steps and live log.">
      {rows.length === 0 ? (
        <EmptyState title="No stage run yet" description="Open a stage of an application above and run it: its runs are listed here." />
      ) : (
        <DataTable label="Recent runs" rows={rows} columns={columns} rowKey={(run) => run.id} initialSort={{ id: "started", desc: true }} pageSize={8} minWidth={680} onRowClick={(run) => navigate(deliveryLink({ projectId, applicationId: run.applicationId, stage: run.name, runId: run.id }))} />
      )}
    </Section>
  );
}

/** One bar per run of a stage, oldest to newest: height is the run time, colour the outcome. */
export function MiniRunBars({ runs, limit = 12 }: { runs: readonly JobRunView[]; limit?: number }): React.JSX.Element {
  const recent = runs.slice(0, limit).reverse();
  const max = Math.max(1, ...recent.map((run) => durationMs(run) ?? 0));
  return (
    <div className="flex h-7 items-end gap-[3px]" aria-hidden>
      {recent.map((run) => {
        const ms = durationMs(run);
        return (
          <span
            key={run.id}
            className={cn("w-[7px] rounded-t-[2px]", isActiveStatus(run.status) && "animate-pulse")}
            style={{ height: Math.max(((ms ?? 0) / max) * 28, 5), backgroundColor: STATUS_COLOR[run.status] ?? CHART_COLOR.muted }}
            title={`${styleOf(RUN_STATUS, run.status).label} · ${formatDateTime(run.createdAt)}${ms === undefined ? "" : ` · ${formatDuration(run.startedAt, run.finishedAt)}`}`}
          />
        );
      })}
    </div>
  );
}

/** A row of segments, one per stage, coloured by the stage's latest run (the application's progress). */
export function PipelineProgress({ states }: { states: Array<{ label: string; status: string | undefined }> }): React.JSX.Element {
  return (
    <div className="flex gap-1" role="img" aria-label={states.map((state) => `${state.label}: ${state.status ?? "not run"}`).join(", ")}>
      {states.map((state) => (
        <span key={state.label} title={`${state.label}: ${state.status === undefined ? "not run yet" : styleOf(RUN_STATUS, state.status).label.toLowerCase()}`} className="h-1.5 min-w-8 flex-1 rounded-full" style={{ backgroundColor: state.status === undefined ? "var(--color-hover)" : (STATUS_COLOR[state.status] ?? CHART_COLOR.muted) }} />
      ))}
    </div>
  );
}
