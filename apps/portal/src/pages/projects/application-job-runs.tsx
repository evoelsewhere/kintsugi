// Job runs of one application (ADR-0027, ADR-0029): a "Run assess" button and the recent
// runs with their status, failure reason, steps, artifacts and the document write (pull
// request) that carries the output to the document repo. Running runs are followed until
// they settle.

import { ChevronDown, ChevronRight, ExternalLink, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { type JobRunDetail, type JobRunStatus, type JobRunView, jobRunsApi } from "@/lib/api/job-runs";

const RUN_TONE: Record<JobRunStatus, StatusTone> = { queued: "muted", running: "blue", succeeded: "green", failed: "red", cancelled: "orange" };

interface Props {
  projectId: string;
  applicationId: string;
  canRun: boolean;
  /** Why the stage cannot start (no legacy or document repo); undefined when it can. */
  blocked?: string;
}

export function ApplicationJobRuns({ projectId, applicationId, canRun, blocked }: Props): React.JSX.Element {
  const [runs, setRuns] = useState<JobRunView[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobRunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRuns((await jobRunsApi.list(projectId, applicationId)).items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [projectId, applicationId]);

  useEffect(() => {
    // load() sets state only after awaiting the API, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Follow runs (and their document writes) until they settle.
  const pending = runs.some((run) => run.status === "queued" || run.status === "running" || run.documentWrite?.status === "queued");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [pending, load]);

  async function toggle(run: JobRunView): Promise<void> {
    if (open === run.id) {
      setOpen(null);
      return;
    }
    setOpen(run.id);
    setDetail(null);
    try {
      setDetail(await jobRunsApi.get(projectId, run.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  async function runAssess(): Promise<void> {
    setBusy(true);
    try {
      await jobRunsApi.runStage(projectId, applicationId, "assess");
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 px-4 py-3 [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-[13px] font-medium text-text">Job runs</h4>
          <p className="text-[12px] text-text-muted">{blocked ?? "Runtime jobs read the legacy repo read-only; their output is proposed to the document repo."}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Refresh job runs" onClick={() => void load()}>
            <RefreshCw className="size-4" />
          </Button>
          {canRun ? (
            <Button size="small" variant="solid" disabled={busy || blocked !== undefined} onClick={() => void runAssess()}>
              <Play className="size-4" />
              {busy ? "Queuing…" : "Run assess"}
            </Button>
          ) : null}
        </div>
      </div>
      {error === null ? null : <p className="text-[12px] text-[var(--ds-status-red)]">{error}</p>}
      {runs.length === 0 ? (
        <p className="text-[12px] text-text-muted">No runs yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {runs.map((run) => (
            <li key={run.id} className="rounded-[var(--geist-radius)] px-2 py-1.5 hover:bg-hover">
              <div className="flex items-start gap-2">
                <button type="button" className="mt-0.5 text-text-muted" aria-label={open === run.id ? "Hide details" : "Show details"} onClick={() => void toggle(run)}>
                  {open === run.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </button>
                <span className="mt-1.5" title={run.status}>
                  <StatusDot tone={RUN_TONE[run.status]} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-text">
                    {run.name} · {run.status}
                  </p>
                  <p className="truncate text-[11px] text-text-muted">
                    {new Date(run.createdAt).toLocaleString()}
                    {run.actor === undefined ? "" : ` · ${run.actor}`}
                    {run.sourceCommit === undefined ? "" : ` · ${run.sourceRepositoryId ?? ""}@${run.sourceCommit.slice(0, 12)}`}
                    {run.outputSummary?.files === undefined ? "" : ` · ${run.outputSummary.files} file(s)`}
                    {run.documentWrite === undefined ? "" : ` · document write ${run.documentWrite.status}`}
                  </p>
                  {run.failureReason === undefined ? null : <p className="mt-0.5 break-words text-[12px] text-[var(--ds-status-red)]">{run.failureReason}</p>}
                  {run.documentWrite?.error === undefined ? null : <p className="mt-0.5 break-words text-[12px] text-[var(--ds-status-red)]">{run.documentWrite.error}</p>}
                </div>
                {run.documentWrite?.prUrl === undefined ? null : (
                  <a href={run.documentWrite.prUrl} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-[12px] text-accent hover:underline">
                    Pull request
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
              {open === run.id ? <RunDetail detail={detail} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RunDetail({ detail }: { detail: JobRunDetail | null }): React.JSX.Element {
  if (detail === null) return <p className="ml-10 mt-1 text-[12px] text-text-muted">Loading…</p>;
  const restricted = detail.restrictedRecords + detail.steps.reduce((total, step) => total + step.restrictedRecords, 0);
  return (
    <div className="ml-10 mt-1 flex flex-col gap-1 text-[12px] text-text-secondary">
      {detail.steps.map((step) => (
        <p key={step.id} className="flex items-center gap-1.5">
          <StatusDot tone={RUN_TONE[step.status]} />
          <span>
            {step.kind} {step.name}
            {step.agent === undefined ? "" : ` (${step.agent})`}
            {step.scriptHash === undefined ? "" : ` (sha256 ${step.scriptHash.slice(0, 12)})`}
            {step.failureReason === undefined ? "" : ` — ${step.failureReason}`}
          </span>
        </p>
      ))}
      {detail.artifacts.length === 0 ? (
        <p className="text-text-muted">No artifacts.</p>
      ) : (
        <ul className="font-mono text-[11px]">
          {detail.artifacts.map((artifact) => (
            <li key={artifact.path}>
              {artifact.path} · {artifact.size} B · {artifact.provenance.runtimeAgent ?? artifact.provenance.origin}
            </li>
          ))}
        </ul>
      )}
      {restricted === 0 ? null : <p className="text-text-muted">{restricted} restricted record(s), not committed (readable with restricted.read).</p>}
    </div>
  );
}
