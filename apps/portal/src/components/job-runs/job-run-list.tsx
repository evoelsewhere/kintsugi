// A list of job runs (Delivery per application, Monitoring across projects): status, what ran,
// when, how long, who started it and where its output went; a row opens the run's detail with
// steps, artifacts and the live log. Active runs can be cancelled with jobs.run.

import { ChevronDown, ChevronRight, ExternalLink, Square } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { RunStatusBadge, WriteStatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { isActive, jobRunsApi, type JobRunView } from "@/lib/api/job-runs";
import { formatDateTime, formatDuration, formatRelative, shortSha } from "@/lib/format";
import { deliveryLink } from "@/lib/links";
import { cn } from "@/lib/utils";
import { RunDetail } from "./run-detail";

export interface JobRunListProps {
  runs: JobRunView[];
  canCancel: boolean;
  /** Cross-project lists show the project and application of each run, linked to Delivery. */
  showProject?: boolean;
  /** A run to open initially (deep links). */
  initialOpen?: string | undefined;
  /** Called after a cancel or when an open run changes status. */
  onChanged: () => void;
}

export function JobRunList({ runs, canCancel, showProject = false, initialOpen, onChanged }: JobRunListProps): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(initialOpen ?? null);
  const [cancelling, setCancelling] = useState<JobRunView | null>(null);
  const toast = useToast();

  return (
    <>
      <ul className="flex flex-col">
        {runs.map((run, index) => {
          const expanded = open === run.id;
          const cancelRequested = run.status === "running" && run.cancelRequestedAt !== undefined;
          return (
            <li key={run.id} className={cn("px-1 py-2", index > 0 && "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]")}>
              <div className="flex items-start gap-2">
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
                    {run.startedAt === undefined ? "" : ` · ${isActive(run) ? "running for " : "took "}${formatDuration(run.startedAt, run.finishedAt)}`}
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
