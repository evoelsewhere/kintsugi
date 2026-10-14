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
import { formatDateTime, formatDuration, formatRelative, shortSha } from "@/lib/format";
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

/** "running for 3m 12s", ticking while the run is active; "took 3m 12s" once it ended. */
function Elapsed({ run }: { run: JobRunView }): React.JSX.Element {
  const active = isActive(run);
  const now = useNow(active);
  return <>{`${active ? "running for " : "took "}${formatDuration(run.startedAt, run.finishedAt, now)}`}</>;
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
                !expanded && index > 0 && "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]",
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
                  className="mt-0.5 rounded-[var(--geist-radius)] text-text-muted hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
                  aria-expanded={expanded}
                  aria-label={expanded ? `Hide details of ${run.name}` : `Show details of ${run.name}`}
                  onClick={() => setOpen(expanded ? null : run.id)}
                >
                  {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="text-left text-[13px] font-medium text-text hover:underline" onClick={() => setOpen(expanded ? null : run.id)}>
                      {run.kind === "stage" ? `Stage ${run.name}` : `${run.kind} ${run.name}`}
                    </button>
                    <RunStatusBadge status={run.status} cancelling={cancelRequested} />
                    {showProject ? (
                      <Link
                        to={deliveryLink({ projectId: run.projectId, applicationId: run.applicationId, stage: run.kind === "stage" ? run.name : undefined, runId: run.id })}
                        className="truncate text-[12px] text-accent hover:underline"
                      >
                        {run.projectId}
                        {run.applicationId === undefined ? "" : ` / ${run.applicationId}`}
                      </Link>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted" title={formatDateTime(run.createdAt)}>
                    {formatRelative(run.createdAt)}
                    {run.startedAt === undefined ? "" : " · "}
                    {run.startedAt === undefined ? null : <Elapsed run={run} />}
                    {run.actor === undefined ? "" : ` · by ${run.actor}`}
                    {run.agent === undefined ? "" : ` · ${run.agent}`}
                    {run.sourceCommit === undefined ? "" : ` · ${run.sourceRepositoryId ?? ""}@${shortSha(run.sourceCommit)}`}
                    {run.outputSummary?.files === undefined ? "" : ` · ${run.outputSummary.files} file(s)`}
                  </p>
                  {run.failureReason === undefined ? null : <p className="mt-0.5 break-words text-[12px] text-[var(--ds-status-red)]">{run.failureReason}</p>}
                  {run.documentWrite?.error === undefined ? null : <p className="mt-0.5 break-words text-[12px] text-[var(--ds-status-red)]">Document write: {run.documentWrite.error}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {run.documentWrite === undefined ? null : <WriteStatusBadge status={run.documentWrite.status} title="Document write of this run" />}
                  {run.documentWrite?.prUrl === undefined ? null : (
                    <a href={run.documentWrite.prUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12px] text-accent hover:underline">
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
