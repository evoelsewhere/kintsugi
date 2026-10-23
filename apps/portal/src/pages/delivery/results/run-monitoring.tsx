// Monitoring of a stage's runs inside its Results tab: the health of the recent runs (success
// rate, durations, a bar per run), the latest run with its steps on a timeline and its document
// write, and the run table. Everything refreshes with the run list; opening a run goes to
// Runs & logs.

import { ArrowUpRight, CircleAlert, LoaderCircle } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { RunStatusBadge, WriteStatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { StatusDot } from "@/components/ui/status-dot";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { type JobRunView, jobRunsApi } from "@/lib/api/job-runs";
import { formatDateTime, formatDuration, formatRelative, shortSha, sourcesLabel } from "@/lib/format";
import { isActiveStatus, RUN_STATUS, styleOf } from "@/lib/status";
import { useLoader } from "@/lib/use-loader";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { Kpi, KpiRow, Section } from "./results-parts";

const STATUS_COLOR: Record<string, string> = {
  succeeded: CHART_COLOR.green,
  failed: CHART_COLOR.red,
  running: CHART_COLOR.blue,
  queued: CHART_COLOR.muted,
  cancelled: CHART_COLOR.orange,
};

const durationMs = (run: Pick<JobRunView, "startedAt" | "finishedAt">, now: number): number | undefined =>
  run.startedAt === undefined ? undefined : Math.max(0, (run.finishedAt === undefined ? now : new Date(run.finishedAt).getTime()) - new Date(run.startedAt).getTime());

const formatMs = (ms: number | undefined): string => (ms === undefined ? "—" : formatDuration(new Date(0).toISOString(), new Date(ms).toISOString()));

/** Opens a run on the Runs & logs tab. */
function useOpenRun(): (id: string) => void {
  const [, setParams] = useSearchParams();
  return (id) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("tab", "runs");
        next.set("run", id);
        return next;
      },
      { replace: true },
    );
}

interface RunStats {
  total: number;
  finished: number;
  succeeded: number;
  failed: number;
  /** 0..1 over finished runs; undefined before any run finished. */
  successRate: number | undefined;
  averageMs: number | undefined;
  lastSuccess: JobRunView | undefined;
}

function runStats(runs: readonly JobRunView[], now: number): RunStats {
  const finished = runs.filter((run) => run.status === "succeeded" || run.status === "failed");
  const durations = runs.filter((run) => run.status === "succeeded").flatMap((run) => durationMs(run, now) ?? []);
  return {
    total: runs.length,
    finished: finished.length,
    succeeded: runs.filter((run) => run.status === "succeeded").length,
    failed: runs.filter((run) => run.status === "failed").length,
    successRate: finished.length === 0 ? undefined : runs.filter((run) => run.status === "succeeded").length / finished.length,
    averageMs: durations.length === 0 ? undefined : durations.reduce((sum, ms) => sum + ms, 0) / durations.length,
    lastSuccess: runs.find((run) => run.status === "succeeded"),
  };
}

/** A strip above the results when the newest run is active or failed: the results shown are older. */
export function LatestRunNotice({ runs }: { runs: readonly JobRunView[] | undefined }): React.JSX.Element | null {
  const openRun = useOpenRun();
  const latest = runs?.[0];
  if (latest === undefined) return null;
  const active = isActiveStatus(latest.status);
  if (!active && latest.status !== "failed") return null;
  return (
    <div className="shadow-border flex flex-wrap items-center gap-3 rounded-xl bg-surface px-4 py-2.5 text-[13px]">
      {active ? <LoaderCircle className="size-4 shrink-0 animate-spin text-text-secondary" /> : <CircleAlert className="size-4 shrink-0 text-[var(--ds-status-red)]" />}
      <span className="min-w-0 flex-1 text-text-secondary">
        {active ? (
          <>
            <span className="font-medium text-text">A run is {latest.status === "queued" ? "queued" : "in progress"}</span> — the figures below are from the last successful run until it finishes.
          </>
        ) : (
          <>
            <span className="font-medium text-text">The latest run failed {formatRelative(latest.finishedAt ?? latest.createdAt)}</span>
            {latest.failureReason === undefined ? "" : `: ${latest.failureReason}`} — the figures below are from the last successful run.
          </>
        )}
      </span>
      <Button size="small" variant="ghost" className="shadow-border" onClick={() => openRun(latest.id)}>
        Open the run
        <ArrowUpRight />
      </Button>
    </div>
  );
}

/** The compact run health card of the overview. */
export function RunSnapshot({ runs, onMore }: { runs: readonly JobRunView[] | undefined; onMore: () => void }): React.JSX.Element {
  const now = useNow(runs?.some((run) => isActiveStatus(run.status)) === true);
  const stats = runs === undefined ? undefined : runStats(runs, now);
  const latest = runs?.[0];
  return (
    <Section
      title="Run health"
      description={stats === undefined ? undefined : `${stats.total} runs of this stage${stats.successRate === undefined ? "" : ` · ${Math.round(stats.successRate * 100)}% of the finished ones succeeded`}`}
      actions={
        <Button size="small" variant="ghost" className="shadow-border" onClick={onMore}>
          Monitoring
          <ArrowUpRight />
        </Button>
      }
    >
      {runs === undefined || latest === undefined ? (
        <p className="text-[12px] text-text-muted">No runs yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <RunStatusBadge status={latest.status} />
            <span className="text-[12px] text-text-secondary" title={formatDateTime(latest.createdAt)}>
              latest run {formatRelative(latest.createdAt)}
              {latest.startedAt === undefined ? "" : ` · ${isActiveStatus(latest.status) ? "running for " : "took "}${formatDuration(latest.startedAt, latest.finishedAt)}`}
            </span>
          </div>
          <RunBars runs={runs} compact />
        </div>
      )}
    </Section>
  );
}

/** One bar per run, oldest to newest: height is the duration, colour the status. */
function RunBars({ runs, compact = false }: { runs: readonly JobRunView[]; compact?: boolean }): React.JSX.Element {
  const openRun = useOpenRun();
  const now = useNow(runs.some((run) => isActiveStatus(run.status)));
  const recent = runs.slice(0, 24).reverse();
  const max = Math.max(1, ...recent.map((run) => durationMs(run, now) ?? 0));
  const height = compact ? 56 : 120;
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {recent.map((run) => {
          const ms = durationMs(run, now);
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => openRun(run.id)}
              title={`${styleOf(RUN_STATUS, run.status).label} · ${formatDateTime(run.createdAt)} · ${formatMs(ms)}`}
              className="group flex h-full min-w-0 max-w-[28px] flex-1 items-end focus-visible:outline-none"
            >
              <span
                className={cn("block w-full rounded-t-[3px] opacity-90 group-hover:opacity-100 group-focus-visible:[box-shadow:var(--ds-focus-ring)]", isActiveStatus(run.status) && "animate-pulse")}
                style={{ height: Math.max(((ms ?? 0) / max) * height, 4), backgroundColor: STATUS_COLOR[run.status] ?? CHART_COLOR.muted }}
              />
            </button>
          );
        })}
      </div>
      {compact ? null : (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
          <span>Oldest → newest · bar height is the run time (longest {formatMs(max)})</span>
          {(["succeeded", "failed", "cancelled", "running"] as const).map((status) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: STATUS_COLOR[status] }} />
              {styleOf(RUN_STATUS, status).label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The steps of the newest run on a timeline: when each started and how long it took. */
function LatestRun({ projectId, run, title }: { projectId: string; run: JobRunView; title: string }): React.JSX.Element {
  const openRun = useOpenRun();
  const detail = useLoader(`monitor-run/${projectId}/${run.id}/${run.status}`, () => jobRunsApi.get(projectId, run.id), { refresh: () => (isActiveStatus(run.status) ? 3000 : false) });
  return (
    <Section
      title={title}
      description={`${formatDateTime(run.createdAt)}${run.sourceCommit === undefined ? "" : ` · source ${run.sources === undefined ? `at ${shortSha(run.sourceCommit)}` : sourcesLabel(run.sources)}`}${run.actor === undefined ? "" : ` · by ${run.actor}`}`}
      actions={
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} cancelling={run.cancelRequestedAt !== undefined && run.status === "running"} />
          <Button size="small" variant="ghost" className="shadow-border" onClick={() => openRun(run.id)}>
            Logs
            <ArrowUpRight />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {run.failureReason === undefined ? null : (
          <p className="flex items-start gap-2 text-[12.5px] text-text-secondary">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--ds-status-red)]" />
            <span className="min-w-0 break-words">{run.failureReason}</span>
          </p>
        )}
        <Loaded loader={detail} rows={3}>
          {(loaded) => <StepTimeline run={loaded} />}
        </Loaded>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary">
          <span>Document write</span>
          {run.documentWrite === undefined ? (
            <span className="text-text-muted">none recorded</span>
          ) : (
            <>
              <WriteStatusBadge status={run.documentWrite.status} />
              {run.documentWrite.branch === undefined ? null : <span className="font-mono text-[11px]">{run.documentWrite.branch}</span>}
              {run.documentWrite.prUrl === undefined ? null : (
                <a href={run.documentWrite.prUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  Open the pull request
                </a>
              )}
              {run.documentWrite.error === undefined ? null : <span className="text-[var(--ds-status-red)]">{run.documentWrite.error}</span>}
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

function StepTimeline({ run }: { run: { startedAt?: string; createdAt: string; finishedAt?: string; steps: JobRunView[] } }): React.JSX.Element {
  const now = useNow(run.finishedAt === undefined);
  const steps = [...run.steps].sort((a, b) => new Date(a.startedAt ?? a.createdAt).getTime() - new Date(b.startedAt ?? b.createdAt).getTime());
  const longest = steps.reduce<JobRunView | undefined>((best, step) => (best === undefined || (durationMs(step, now) ?? 0) > (durationMs(best, now) ?? 0) ? step : best), undefined);
  // A retry is the next attempt of the same run: steps it kept from an earlier attempt started before the run's own start, so the axis begins at the earliest of them.
  const origin = Math.min(new Date(run.startedAt ?? run.createdAt).getTime(), ...steps.flatMap((step) => (step.startedAt === undefined ? [] : [new Date(step.startedAt).getTime()])));
  const end = run.finishedAt === undefined ? now : new Date(run.finishedAt).getTime();
  const span = Math.max(1, end - origin, ...steps.map((step) => (step.finishedAt === undefined ? now : new Date(step.finishedAt).getTime()) - origin));
  if (steps.length === 0) return <p className="text-[12px] text-text-muted">{run.startedAt === undefined ? "Waiting for the worker to start it." : "The run recorded no steps."}</p>;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span>Steps · {steps.length}</span>
        <span>
          {formatMs(span)} in total{longest === undefined || steps.length < 2 ? "" : ` · longest: ${longest.name} (${formatMs(durationMs(longest, now))})`}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {steps.map((step) => {
          const start = step.startedAt === undefined ? undefined : new Date(step.startedAt).getTime();
          const stop = step.finishedAt === undefined ? now : new Date(step.finishedAt).getTime();
          const left = start === undefined ? 0 : ((start - origin) / span) * 100;
          const width = start === undefined ? 0 : Math.max(((stop - start) / span) * 100, 0.8);
          return (
            <li key={step.id} className="grid grid-cols-[minmax(120px,220px)_1fr_64px] items-center gap-3" title={step.failureReason}>
              <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-text">
                <StatusDot tone={styleOf(RUN_STATUS, step.status).tone} className="size-2" />
                <span className="truncate">{step.name}</span>
                {step.kind === "agent" ? <span className="shrink-0 text-[11px] text-text-muted">agent</span> : null}
              </span>
              <span className="relative h-2 rounded-full bg-hover">
                <span
                  className={cn("absolute inset-y-0 rounded-full", isActiveStatus(step.status) && "animate-pulse")}
                  style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, backgroundColor: STATUS_COLOR[step.status] ?? CHART_COLOR.muted }}
                />
              </span>
              <span className="text-right text-[12px] text-text-secondary tabular-nums">{start === undefined ? "—" : formatMs(stop - start)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The Monitoring tab: health of the recent runs, the latest run and every run. */
export function MonitoringTab({ projectId, runs }: { projectId: string; runs: readonly JobRunView[] | undefined }): React.JSX.Element {
  const openRun = useOpenRun();
  const now = useNow(runs?.some((run) => isActiveStatus(run.status)) === true);
  if (runs === undefined) return <p className="text-[12px] text-text-muted">Loading the runs…</p>;
  if (runs.length === 0) return <p className="text-[12px] text-text-muted">This stage has not run for the application.</p>;
  const stats = runStats(runs, now);
  const columns: Column<JobRunView>[] = [
    { id: "status", header: "Status", cell: (run) => <RunStatusBadge status={run.status} />, sort: (run) => run.status },
    { id: "started", header: "Started", cell: (run) => <span title={formatDateTime(run.createdAt)}>{formatRelative(run.createdAt)}</span>, sort: (run) => run.createdAt },
    { id: "duration", header: "Duration", cell: (run) => <span className="tabular-nums">{formatMs(durationMs(run, now))}</span>, sort: (run) => durationMs(run, now), align: "right" },
    { id: "commit", header: "Source", cell: (run) => <span className="font-mono text-[12px] text-text-secondary">{run.sourceCommit === undefined ? "—" : run.sources === undefined ? shortSha(run.sourceCommit) : sourcesLabel(run.sources)}</span>, sort: (run) => run.sourceCommit },
    ...(runs.some((run) => run.scope !== undefined)
      ? [{ id: "items", header: "Items", cell: (run: JobRunView) => (run.scope === undefined ? "—" : String(run.scope.items.length)), sort: (run: JobRunView) => run.scope?.items.length, align: "right" as const, title: "Catalog items the run covered" }]
      : []),
    { id: "files", header: "Output files", cell: (run) => (run.outputSummary?.files === undefined ? "—" : String(run.outputSummary.files)), sort: (run) => run.outputSummary?.files, align: "right" },
    { id: "write", header: "Document write", cell: (run) => (run.documentWrite === undefined ? <span className="text-text-muted">—</span> : <WriteStatusBadge status={run.documentWrite.status} />), sort: (run) => run.documentWrite?.status },
    { id: "reason", header: "Note", cell: (run) => <span className="line-clamp-1 text-text-secondary" title={run.failureReason}>{run.failureReason ?? ""}</span> },
  ];
  const latest = runs[0];
  // A queued run has no steps yet: show the newest one the worker has started.
  const shown = latest?.startedAt === undefined ? (runs.find((run) => run.startedAt !== undefined) ?? latest) : latest;
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Runs" value={stats.total} hint={`${stats.succeeded} succeeded · ${stats.failed} failed`} />
        <Kpi label="Success rate" value={undefined} display={stats.successRate === undefined ? "—" : `${Math.round(stats.successRate * 100)}%`} hint={`of ${stats.finished} finished runs`} tone={stats.successRate === undefined ? "muted" : stats.successRate >= 0.8 ? "green" : stats.successRate >= 0.5 ? "orange" : "red"} />
        <Kpi label="Average run time" value={undefined} display={formatMs(stats.averageMs)} hint="successful runs" />
        <Kpi label="Last success" value={undefined} display={stats.lastSuccess === undefined ? "—" : formatRelative(stats.lastSuccess.finishedAt ?? stats.lastSuccess.createdAt)} hint={stats.lastSuccess?.sourceCommit === undefined ? undefined : `source at ${shortSha(stats.lastSuccess.sourceCommit)}`} />
        <Kpi label="Latest run" value={undefined} display={styleOf(RUN_STATUS, latest?.status).label} hint={latest === undefined ? undefined : formatRelative(latest.createdAt)} tone={styleOf(RUN_STATUS, latest?.status).tone} />
        <Kpi label="Restricted records" value={runs.reduce((sum, run) => sum + run.restrictedRecords, 0)} hint="kept out of the document repo" />
      </KpiRow>
      <Section title="Run history" description="The most recent runs of the stage, each bar one run.">
        <RunBars runs={runs} />
      </Section>
      {shown === undefined ? null : <LatestRun projectId={projectId} run={shown} title={shown === latest ? "Latest run" : "Last run that started"} />}
      <Section title="All runs" description="Open a run for its steps, artifacts and live log.">
        <DataTable label="Runs" rows={runs} columns={columns} rowKey={(run) => run.id} initialSort={{ id: "started", desc: true }} pageSize={10} onRowClick={(run) => openRun(run.id)} minWidth={720} />
      </Section>
    </div>
  );
}
