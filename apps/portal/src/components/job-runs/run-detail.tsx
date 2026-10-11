// The detail of one job run (ADR-0027, ADR-0029): its steps, the artifacts it proposed to the
// document repo (with the branch, commit and pull request of the document write that carries
// them) and its live log over Server-Sent Events. Restricted records are only counted here;
// holders of restricted.read open them in Governance (every read is audited).

import { ExternalLink, FileText, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { RunStatusBadge, WriteStatusBadge } from "@/components/status-badges";
import { StatusDot } from "@/components/ui/status-dot";
import { type JobRunDetail, type JobRunEvent, jobRunsApi } from "@/lib/api/job-runs";
import { useAuth } from "@/lib/auth";
import { formatBytes, formatDuration, shortSha } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";

export function RunDetail({ projectId, runId, version, onStatusChange }: { projectId: string; runId: string; version: string; onStatusChange: () => void }): React.JSX.Element {
  // `version` changes when the run's status or document write changes: the detail reloads.
  const detail = useLoader(`${projectId}/${runId}/${version}`, () => jobRunsApi.get(projectId, runId));
  return (
    <div className="flex flex-col gap-3 pt-2 pb-1 pl-7">
      <Loaded loader={detail} rows={2}>
        {(run) => <RunFacts run={run} />}
      </Loaded>
      <LiveLog projectId={projectId} runId={runId} onStatus={onStatusChange} />
    </div>
  );
}

function RunFacts({ run }: { run: JobRunDetail }): React.JSX.Element {
  const { can } = useAuth();
  const restricted = run.restrictedRecords + run.steps.reduce((total, step) => total + step.restrictedRecords, 0);
  const write = run.documentWrite;
  return (
    <div className="flex flex-col gap-3 text-[12px] text-text-secondary">
      <section>
        <h5 className="mb-1 text-[11px] font-medium tracking-wide text-text-muted uppercase">Steps</h5>
        {run.steps.length === 0 ? (
          <p className="text-text-muted">No steps recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {run.steps.map((step) => (
              <li key={step.id} className="flex flex-wrap items-center gap-2">
                <RunStatusBadge status={step.status} />
                <span className="text-text">
                  {step.kind} · {step.name}
                </span>
                <span className="text-text-muted">
                  {step.agent === undefined ? "" : step.agent}
                  {step.scriptHash === undefined ? "" : `sha256 ${step.scriptHash.slice(0, 12)}`}
                  {step.startedAt === undefined ? "" : ` · ${formatDuration(step.startedAt, step.finishedAt)}`}
                </span>
                {step.failureReason === undefined ? null : <span className="w-full break-words text-[var(--ds-status-red)]">{step.failureReason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h5 className="mb-1 text-[11px] font-medium tracking-wide text-text-muted uppercase">Artifacts in the document repo</h5>
        {run.artifacts.length === 0 ? (
          <p className="text-text-muted">{run.status === "succeeded" ? "The run produced no artifacts." : "Artifacts appear when the run has succeeded."}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {run.artifacts.map((artifact) => (
              <li key={artifact.path} className="flex items-center gap-2 font-mono text-[11px]">
                <FileText className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.5} />
                <span className="min-w-0 truncate text-text" title={`sha256 ${artifact.sha256}`}>
                  {artifact.path}
                </span>
                <span className="shrink-0 text-text-muted">
                  {formatBytes(artifact.size)} · {artifact.provenance.runtimeAgent ?? artifact.provenance.origin}
                </span>
              </li>
            ))}
          </ul>
        )}
        {write === undefined ? null : (
          <p className="mt-1.5 flex flex-wrap items-center gap-2">
            <WriteStatusBadge status={write.status} />
            {write.branch === undefined ? null : (
              <span className="font-mono text-[11px] text-text-muted" title="Branch in the document repo">
                {write.branch}
              </span>
            )}
            {write.prUrl === undefined ? null : (
              <a href={write.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                Pull request
                <ExternalLink className="size-3.5" />
              </a>
            )}
            {write.error === undefined ? null : <span className="w-full break-words text-[var(--ds-status-red)]">{write.error}</span>}
          </p>
        )}
        {run.sourceCommit === undefined ? null : (
          <p className="mt-1 text-text-muted">
            Source: {run.sourceRepositoryId ?? "legacy repo"} @ <span className="font-mono">{shortSha(run.sourceCommit)}</span> (read-only)
          </p>
        )}
      </section>

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
    </div>
  );
}

const MAX_LOG_LINES = 300;

const EVENT_TONE: Partial<Record<JobRunEvent["kind"], string>> = {
  status: "text-text",
  "step.started": "text-text-secondary",
  "step.finished": "text-text-secondary",
};

/** The run's live log: its recorded events, then new ones as the worker records them. */
export function LiveLog({ projectId, runId, onStatus }: { projectId: string; runId: string; onStatus: () => void }): React.JSX.Element {
  const [events, setEvents] = useState<JobRunEvent[]>([]);
  const [live, setLive] = useState(true);
  const box = useRef<HTMLDivElement | null>(null);
  const statusChanged = useRef(onStatus);
  useEffect(() => {
    statusChanged.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    let first = true;
    const close = jobRunsApi.follow(projectId, runId, {
      onEvent: (event) => setEvents((current) => [...current, event].slice(-MAX_LOG_LINES)),
      onStatus: () => {
        // The first status is the current one; later ones are changes.
        if (!first) statusChanged.current();
        first = false;
      },
      onEnd: () => {
        setLive(false);
        if (!first) statusChanged.current();
      },
    });
    return close;
  }, [projectId, runId]);

  useEffect(() => {
    // Keep the newest line visible without scrolling the page.
    const element = box.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [events.length]);

  return (
    <section className="flex flex-col gap-1">
      <h5 className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-text-muted uppercase">
        {live ? <StatusDot tone="blue" className="size-2 animate-pulse" /> : null}
        {live ? "Live log" : "Log"}
      </h5>
      {events.length === 0 ? (
        <p className="text-[12px] text-text-muted">{live ? "Waiting for events…" : "No events recorded."}</p>
      ) : (
        <div ref={box} className="max-h-64 overflow-y-auto rounded-[var(--geist-radius)] bg-recessed px-2 py-1 font-mono text-[11px] leading-5">
          {events.map((event) => (
            <p key={event.id} className={`break-words ${EVENT_TONE[event.kind] ?? "text-text-muted"}`}>
              <span className="text-text-muted">{new Date(event.at).toLocaleTimeString()} </span>
              {event.kind === "tool" ? "  " : ""}
              {event.message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
