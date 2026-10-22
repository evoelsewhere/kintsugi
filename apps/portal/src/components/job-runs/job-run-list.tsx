// A list of job runs (Delivery per application, Monitoring across projects): status, what ran,
// when, how long, who started it and where its output went; a row opens the run's detail with
// steps, artifacts and the live log. Active runs can be cancelled, and a failed stage run retried
// (it resumes from the kept outputs and skips the agent steps that succeeded), with jobs.run.

import { ChevronDown, ChevronRight, ExternalLink, RotateCcw, Square } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { RunStatusBadge, WriteStatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { isActive, jobRunsApi, type JobRunView } from "@/lib/api/job-runs";
import { formatDateTime, formatDuration, formatRelative, shortSha, sourcesLabel } from "@/lib/format";
import { deliveryLink } from "@/lib/links";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { RunDetail } from "./run-detail";

export interface JobRunListProps {
  runs: JobRunView[];
  canCancel: boolean;
  /** Shows Retry on a failed stage run of an application. */
  canRetry?: boolean;
  /** Cross-project lists show the project and application of each run, linked to Delivery. */
  showProject?: boolean;
  /** A run to open initially (deep links). */
  initialOpen?: string | undefined;
  /** Called after a cancel or when an open run changes status. */
  onChanged: () => void;
}

/** "3m 12s", ticking while the run is active; "—" before it started. */
function Elapsed({ run }: { run: JobRunView }): React.JSX.Element {
  const active = isActive(run);
  const now = useNow(active);
  return <>{formatDuration(run.startedAt, run.finishedAt, now)}</>;
}

/** A failure line: small red dot, two lines at most, the full text on hover. */
function Failure({ text }: { text: string }): React.JSX.Element {
  return (
    <p className="mt-0.5 flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-[var(--ds-status-red)]" title={text}>
      <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-[var(--ds-status-red)]" aria-hidden />
      <span className="line-clamp-2 break-words">{text}</span>
    </p>
  );
}

export function JobRunList({ runs, canCancel, canRetry = false, showProject = false, initialOpen, onChanged }: JobRunListProps): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(initialOpen ?? null);
  const [cancelling, setCancelling] = useState<JobRunView | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const toast = useToast();

  async function retry(run: JobRunView): Promise<void> {
    setRetrying(run.id);
    try {
      const next = await jobRunsApi.retry(run.projectId, run.id);
      toast.success("Retry queued", "It skips the agent jobs that succeeded and reruns the rest.");
      setOpen(next.id);
      onChanged();
    } catch (failure) {
      toast.error("Could not retry the run", failure);
    } finally {
      setRetrying(null);
    }
  }

  return (
    <>
      <ul className="flex flex-col">
        {runs.map((run, index) => {
          const expanded = open === run.id;
          const cancelRequested = run.status === "running" && run.cancelRequestedAt !== undefined;
          return (
            <li
              key={run.id}
              className={cn(
                "my-0.5 rounded-xl px-2 py-2",
                expanded ? "bg-surface [box-shadow:var(--ds-shadow-border-small)]" : "hover:bg-hover",
                !expanded && index > 0 && "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)] dark:[box-shadow:0_-1px_0_rgba(255,255,255,0.08)]",
              )}
            >
              <div
                className="flex cursor-pointer items-start gap-2"
                onClick={(event) => {
                  // The whole header opens the run; links and buttons inside keep their own action.
                  if ((event.target as HTMLElement).closest("a,button") === null) setOpen(expanded ? null : run.id);
                }}
              >
                <button
                  type="button"
                  className="flex h-7 shrink-0 items-center rounded-[var(--geist-radius)] text-text-muted hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
                  aria-expanded={expanded}
                  aria-label={expanded ? `Hide details of ${run.name}` : `Show details of ${run.name}`}
                  onClick={() => setOpen(expanded ? null : run.id)}
                >
                  {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      className="rounded-[var(--geist-radius)] text-left text-[13px] font-medium text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
                      title={run.name}
                      onClick={() => setOpen(expanded ? null : run.id)}
                    >
                      {run.name}
                      <span className="ml-1.5 font-mono text-[11px] font-normal text-text-muted">{run.kind}</span>
                    </button>
                    <RunStatusBadge status={run.status} cancelling={cancelRequested} />
                    {showProject ? (
                      <Link
                        to={deliveryLink({ projectId: run.projectId, applicationId: run.applicationId, stage: run.kind === "stage" ? run.name : undefined, runId: run.id })}
                        className="min-w-0 truncate rounded-[var(--geist-radius)] text-[12px] text-accent hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
                      >
                        {run.projectId}
                        {run.applicationId === undefined ? "" : ` / ${run.applicationId}`}
                      </Link>
                    ) : null}
                  </div>
                  {run.actor === undefined && run.agent === undefined && run.sourceCommit === undefined && run.outputSummary?.files === undefined ? null : (
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-text-muted">
                      {run.actor === undefined ? null : <span className="rounded-full bg-hover px-1.5 py-0.5">by {run.actor}</span>}
                      {run.agent === undefined ? null : <span className="rounded-full bg-hover px-1.5 py-0.5">{run.agent}</span>}
                      {run.sourceCommit === undefined ? null : (
                        <span className="rounded-full bg-hover px-1.5 py-0.5 font-mono">
                          {run.sources === undefined ? `${run.sourceRepositoryId === undefined ? "" : `${run.sourceRepositoryId}@`}${shortSha(run.sourceCommit)}` : sourcesLabel(run.sources)}
                        </span>
                      )}
                      {run.outputSummary?.files === undefined ? null : (
                        <span className="rounded-full bg-hover px-1.5 py-0.5 tabular-nums">
                          {run.outputSummary.files} {run.outputSummary.files === 1 ? "file" : "files"}
                        </span>
                      )}
                    </p>
                  )}
                  {run.failureReason === undefined ? null : <Failure text={run.failureReason} />}
                  {run.documentWrite?.error === undefined ? null : <Failure text={`Document write: ${run.documentWrite.error}`} />}
                </div>
                <span className="w-16 shrink-0 text-right text-[11.5px] leading-7 tabular-nums text-text-secondary" title="Run time">
                  {run.startedAt === undefined ? "—" : <Elapsed run={run} />}
                </span>
                <span className="hidden w-20 shrink-0 text-right text-[11.5px] leading-7 tabular-nums text-text-muted sm:block" title={formatDateTime(run.createdAt)}>
                  {formatRelative(run.createdAt)}
                </span>
                <div className="flex h-7 shrink-0 items-center gap-2">
                  {run.documentWrite === undefined ? null : <WriteStatusBadge status={run.documentWrite.status} title="Document write of this run" />}
                  {run.documentWrite?.prUrl === undefined ? null : (
                    <a
                      href={run.documentWrite.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 rounded-[var(--geist-radius)] text-[12px] text-accent hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
                    >
                      PR
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                  {canRetry && run.status === "failed" && run.kind === "stage" && run.applicationId !== undefined ? (
                    <Button size="small" variant="ghost" className="shadow-border" disabled={retrying !== null} onClick={() => void retry(run)}>
                      <RotateCcw className="size-3.5" />
                      {retrying === run.id ? "Retrying…" : "Retry"}
                    </Button>
                  ) : null}
                  {canCancel && isActive(run) && run.cancelRequestedAt === undefined ? (
                    <Button size="small" variant="danger" onClick={() => setCancelling(run)}>
                      <Square className="size-3.5" />
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
              {expanded ? (
                <RunDetail
                  projectId={run.projectId}
                  runId={run.id}
                  version={`${run.status}/${run.documentWrite?.status ?? ""}/${run.cancelRequestedAt ?? ""}`}
                  onStatusChange={onChanged}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={cancelling !== null}
        title="Cancel job run?"
        confirmLabel="Cancel run"
        busyLabel="Cancelling…"
        onConfirm={async () => {
          if (cancelling === null) return;
          await jobRunsApi.cancel(cancelling.projectId, cancelling.id);
          toast.success(cancelling.status === "running" ? "Cancel requested" : "Run cancelled", `${cancelling.name} · ${cancelling.projectId}`);
          onChanged();
        }}
        onClose={() => setCancelling(null)}
      >
        {cancelling?.status === "running"
          ? `The worker stops ${cancelling.name} now: its running processes are killed and nothing it produced is proposed to the document repo.`
          : `${cancelling?.name ?? "The run"} has not started yet and will not run.`}
      </ConfirmDialog>
    </>
  );
}
