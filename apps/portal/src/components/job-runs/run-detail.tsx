// The detail of one job run (ADR-0027, ADR-0029) as a console: a summary of where the run is
// (steps done, how long, tool calls), its steps as a selectable timeline (a workflow step opens
// to its agent jobs and script steps), a log console that follows the run over Server-Sent
// Events and filters to the selected step, and the artifacts it proposed to the document repo
// (with the branch, commit and pull request of the document write that carries them).
// Restricted records are only counted here; holders of restricted.read open them in Governance
// (every read is audited).

import { Check, Copy, ExternalLink, FileText, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { RunStatusBadge, WriteStatusBadge } from "@/components/status-badges";
import { RUN_COLOR } from "@/components/results/status-colors";
import { useToast } from "@/components/ui/toast";
import { type JobRunDetail, jobRunsApi } from "@/lib/api/job-runs";
import { useAuth } from "@/lib/auth";
import { formatBytes, formatDuration, shortSha } from "@/lib/format";
import { telemetryTraceLink } from "@/lib/links";
import { isActiveStatus } from "@/lib/status";
import { cacheHitRate, formatCost, formatRate, formatTokens, sumUsage } from "@/lib/telemetry";
import { useLoader } from "@/lib/use-loader";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { type StepStats, statsByStep, useRunEvents, withDescendants } from "./run-events";
import { RunLog } from "./run-log";
import { StepList, type StepsContext } from "./run-steps";

export function RunDetail({ projectId, runId, version, onStatusChange }: { projectId: string; runId: string; version: string; onStatusChange: () => void }): React.JSX.Element {
  // `version` changes when the run's status or document write changes, and `steps` each time a step of the
  // run starts or finishes (from the live log): the detail reloads, so a running run shows its steps.
  const [steps, setSteps] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The recorded events replay in a burst when the log opens: one reload for the burst.
  const stepsChanged = useCallback((): void => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSteps((count) => count + 1), 600);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const detail = useLoader(`${projectId}/${runId}/${version}/${steps}`, () => jobRunsApi.get(projectId, runId));
  // Keep showing the last answer while the next one loads, so a step change does not flash a skeleton.
  const [shown, setShown] = useState<JobRunDetail | undefined>(undefined);
  if (detail.data !== undefined && detail.data !== shown) setShown(detail.data);
  const { events, live } = useRunEvents(projectId, runId, { onStatus: onStatusChange, onStep: stepsChanged });

  return (
    <div className="flex flex-col gap-4 pt-3 pb-1 pl-7">
      {shown === undefined ? (
        <Loaded loader={detail} rows={3}>
          {() => null}
        </Loaded>
      ) : (
        <RunConsole run={shown} events={events} live={live} version={version} />
      )}
    </div>
  );
}

function RunConsole({ run, events, live, version }: { run: JobRunDetail; events: ReturnType<typeof useRunEvents>["events"]; live: boolean; version: string }): React.JSX.Element {
  const active = isActiveStatus(run.status);
  const now = useNow(active);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [childrenOf, setChildrenOf] = useState<Record<string, string[]>>({});
  const onChildren = useCallback((id: string, children: string[]) => {
    setChildrenOf((current) => (current[id]?.join(",") === children.join(",") ? current : { ...current, [id]: children }));
  }, []);
  const stats = useMemo(() => statsByStep(events), [events]);

  const origin = new Date(run.startedAt ?? run.createdAt).getTime();
  const end = run.finishedAt === undefined ? now : new Date(run.finishedAt).getTime();
  const span = Math.max(1000, end - origin, ...run.steps.map((step) => (step.finishedAt === undefined ? now : new Date(step.finishedAt).getTime()) - origin));

  const labels = useMemo(() => {
    const map = new Map<string, string>([["", "run"]]);
    // Steps of the same name (two jobs of one agent) are told apart by their order.
    const seen = new Map<string, number>();
    const total = new Map<string, number>();
    for (const step of run.steps) total.set(step.name, (total.get(step.name) ?? 0) + 1);
    for (const step of run.steps) {
      const index = (seen.get(step.name) ?? 0) + 1;
      seen.set(step.name, index);
      map.set(step.id, (total.get(step.name) ?? 1) > 1 ? `${step.name} #${index}` : step.name);
    }
    return map;
  }, [run.steps]);
  const stepLabel = useCallback((id: string | undefined): string => labels.get(id ?? "") ?? (id === undefined ? "run" : id.slice(0, 8)), [labels]);
  const selectedIds = useMemo(() => (selected === undefined ? undefined : withDescendants(selected, childrenOf)), [selected, childrenOf]);

  // Agents still working, with the model's latest report: a long thinking turn writes no tool call.
  const working = [...stats.entries()]
    .filter(([id, entry]) => id !== "" && !entry.finished && entry.progress !== undefined && (selectedIds === undefined || selectedIds.has(id)))
    .map(([id, entry]) => ({ id, label: stepLabel(id), progress: entry.progress!, lastToolAt: entry.lastAt }));

  const context: StepsContext = { projectId: run.projectId, origin, span, now, stats, selected, onSelect: setSelected, onChildren, version };
  return (
    <>
      <RunSummary run={run} stats={stats} events={events.length} now={now} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(280px,4fr)_minmax(0,7fr)]">
        <section className="flex min-w-0 flex-col gap-1.5">
          <h5 className="text-[11px] font-medium tracking-wide text-text-muted uppercase">Steps</h5>
          {run.steps.length === 0 ? <p className="text-[12px] text-text-muted">{active ? "Waiting for the first step…" : "No steps recorded."}</p> : (
            <div className="max-h-[540px] min-h-32 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
              <StepList steps={run.steps} context={context} />
            </div>
          )}
        </section>
        <RunLog
          events={events}
          live={live}
          runStart={origin}
          stepLabel={stepLabel}
          stepIds={selectedIds}
          stepName={selected === undefined ? undefined : stepLabel(selected)}
          onClearStep={() => setSelected(undefined)}
          working={live ? working : []}
          now={now}
        />
      </div>
      <RunOutput run={run} />
    </>
  );
}

/** Where the run is: step progress, time, tool calls and the problems so far. */
function RunSummary({ run, stats, events, now }: { run: JobRunDetail; stats: ReadonlyMap<string, StepStats>; events: number; now: number }): React.JSX.Element {
  const { can } = useAuth();
  const counts = { succeeded: 0, running: 0, failed: 0, queued: 0, cancelled: 0 } as Record<string, number>;
  for (const step of run.steps) counts[step.status] = (counts[step.status] ?? 0) + 1;
  const total = run.steps.length;
  const tools = [...stats.values()].reduce((sum, entry) => sum + entry.total, 0);
  const blocked = [...stats.values()].reduce((sum, entry) => sum + entry.blocked, 0);
  const turns = Math.max(0, ...[...stats.values()].map((entry) => entry.turn ?? 0));
  const done = (counts["succeeded"] ?? 0) + (counts["failed"] ?? 0) + (counts["cancelled"] ?? 0);
  const usage = sumUsage(run.steps);
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-recessed/60 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RunStatusBadge status={run.status} cancelling={run.cancelRequestedAt !== undefined && run.status === "running"} />
        <span className="text-[12px] tabular-nums text-text-secondary">
          {run.startedAt === undefined ? "Waiting for the worker" : `${isActiveStatus(run.status) ? "running for" : "took"} ${formatDuration(run.startedAt, run.finishedAt, now)}`}
        </span>
      </div>
      {total === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <div className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-hover" role="img" aria-label={`${done} of ${total} steps finished`}>
            {(["succeeded", "running", "queued", "failed", "cancelled"] as const).map((status) =>
              (counts[status] ?? 0) === 0 ? null : (
                <span key={status} className={cn("h-full", status === "running" && "animate-pulse")} style={{ width: `${((counts[status] ?? 0) / total) * 100}%`, backgroundColor: status === "queued" ? "var(--color-hover)" : (RUN_COLOR[status] ?? "var(--ds-text-muted)") }} title={`${counts[status]} ${status}`} />
              ),
            )}
          </div>
          <p className="text-[11.5px] text-text-muted tabular-nums">
            {done} of {total} steps finished
            {(counts["running"] ?? 0) > 0 ? ` · ${counts["running"]} running` : ""}
            {(counts["failed"] ?? 0) > 0 ? ` · ${counts["failed"]} failed` : ""}
          </p>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Figure label="Tool calls" value={tools} />
        <Figure label="Model turns" value={turns} hint="the furthest agent" />
        <Figure label="Blocked calls" value={blocked} tone={blocked > 0 ? "var(--ds-status-red)" : undefined} />
        <Figure label="Log lines" value={events} />
      </dl>
      {usage === undefined ? null : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Figure label="Tokens" value={usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens} display={formatTokens(usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens)} hint={`new in ${formatTokens(usage.inputTokens)} · out ${formatTokens(usage.outputTokens)}`} />
            <Figure label="Read from cache" value={usage.cacheReadTokens} display={formatRate(cacheHitRate(usage))} hint={`${formatTokens(usage.cacheReadTokens)} tokens`} />
            <Figure label="Compactions" value={usage.compactions} />
            <Figure label="Cost" value={usage.costUsd} display={formatCost(usage.costUsd)} />
          </dl>
          {can("telemetry.view") ? (
            <Link to={telemetryTraceLink({ runId: run.id })} className="w-fit text-[12px] text-text-secondary underline-offset-2 hover:text-text hover:underline">
              View the trace in Governance → Telemetry
            </Link>
          ) : null}
        </>
      )}
    </div>
  );
}

function Figure({ label, value, display, hint, tone }: { label: string; value: number; display?: string; hint?: string; tone?: string | undefined }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-text-muted">{label}</dt>
      <dd className="text-[18px] leading-6 font-semibold tracking-tight text-text tabular-nums" style={tone === undefined ? undefined : { color: tone }}>
        {display ?? value.toLocaleString()}
      </dd>
      {hint === undefined ? null : <p className="truncate text-[10.5px] text-text-muted">{hint}</p>}
    </div>
  );
}

function CopyPath({ path }: { path: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <button
      type="button"
      aria-label={`Copy ${path}`}
      title="Copy the path"
      onClick={() => {
        navigator.clipboard.writeText(path).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          (failure: unknown) => toast.error("Could not copy the path", failure),
        );
      }}
      className="shrink-0 rounded-[var(--geist-radius)] p-1 text-text-muted hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
    >
      {copied ? <Check className="size-3.5 text-[var(--ds-status-green)]" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** The artifacts, the document write that carries them, the source commit and the restricted records. */
function RunOutput({ run }: { run: JobRunDetail }): React.JSX.Element {
  const { can } = useAuth();
  const restricted = run.restrictedRecords + run.steps.reduce((total, step) => total + step.restrictedRecords, 0);
  const write = run.documentWrite;
  const size = run.artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
  return (
    <section className="flex flex-col gap-2 text-[12px] text-text-secondary">
      <h5 className="text-[11px] font-medium tracking-wide text-text-muted uppercase">
        Artifacts in the document repo
        {run.artifacts.length === 0 ? "" : ` · ${run.artifacts.length} file${run.artifacts.length === 1 ? "" : "s"} · ${formatBytes(size)}`}
      </h5>
      {run.artifacts.length === 0 ? (
        <p className="text-text-muted">{run.status === "succeeded" ? "The run produced no artifacts." : "Artifacts appear when the run has succeeded."}</p>
      ) : (
        <ul className="flex flex-col">
          {run.artifacts.map((artifact) => (
            <li key={artifact.path} className="flex items-center gap-2 rounded-[var(--geist-radius)] px-1.5 py-1 hover:bg-hover">
              <FileText className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text" title={`${artifact.path}\nsha256 ${artifact.sha256}`}>
                {artifact.path}
              </span>
              <span className="max-w-32 shrink-0 truncate rounded-full bg-hover px-1.5 py-0.5 text-[11px] text-text-muted" title={artifact.provenance.runtimeAgent ?? artifact.provenance.origin}>
                {artifact.provenance.runtimeAgent ?? artifact.provenance.origin}
              </span>
              <span className="w-16 shrink-0 text-right text-[11.5px] tabular-nums text-text-secondary">{formatBytes(artifact.size)}</span>
              <CopyPath path={artifact.path} />
            </li>
          ))}
        </ul>
      )}
      {write === undefined ? null : (
        <p className="flex flex-wrap items-center gap-2">
          <WriteStatusBadge status={write.status} />
          {write.branch === undefined ? null : (
            <span className="max-w-full truncate font-mono text-[11px] text-text-muted" title="Branch in the document repo">
              {write.branch}
            </span>
          )}
          {write.prUrl === undefined ? null : (
            <a href={write.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-[var(--geist-radius)] text-accent hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
              Pull request
              <ExternalLink className="size-3.5" />
            </a>
          )}
          {write.error === undefined ? null : (
            <span className="flex w-full items-start gap-1.5 text-[11.5px] leading-[1.45] text-[var(--ds-status-red)]" title={write.error}>
              <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-[var(--ds-status-red)]" aria-hidden />
              <span className="line-clamp-2 break-words">{write.error}</span>
            </span>
          )}
        </p>
      )}
      {run.sourceCommit === undefined ? null : (
        <p className="text-text-muted">
          Source: {run.sourceRepositoryId ?? "legacy repo"} @ <span className="font-mono">{shortSha(run.sourceCommit)}</span> (read-only)
        </p>
      )}
      {restricted === 0 ? null : (
        <p className="flex flex-wrap items-center gap-1.5 text-text-muted">
          <ShieldAlert className="size-3.5" strokeWidth={1.75} />
          {restricted} restricted record{restricted === 1 ? "" : "s"}, never committed.
          {can("restricted.read") ? (
            <Link to={`/governance?tab=restricted&run=${encodeURIComponent(run.id)}`} className="text-accent hover:underline">
              Open in Governance
            </Link>
          ) : (
            <span>Readable with restricted.read.</span>
          )}
        </p>
      )}
    </section>
  );
}
