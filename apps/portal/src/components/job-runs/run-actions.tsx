import { canAbandonDocumentWrite } from "@kintsugi/domain";
import { ExternalLink, RotateCcw, Square, Undo2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { isActive, jobRunsApi, type JobRunView } from "@/lib/api/job-runs";
import { retryNotice } from "./run-model";

type Action = "cancel" | "fresh" | "abandon";
export interface RunActionProps {
  canCancel: boolean;
  canRetry?: boolean;
  canAbandon?: boolean;
  scopeNoun?: string;
  onRetried?: (run: JobRunView) => void;
  onChanged: () => void;
}

export function RunActions({
  run,
  canCancel,
  canRetry,
  canAbandon,
  scopeNoun = "item",
  onRetried,
  onChanged,
}: RunActionProps & { run: JobRunView }): React.JSX.Element {
  const toast = useToast();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  // A cancelled run keeps its finished steps like a failed one (ADR-0090), so both can be retried.
  const retryable =
    canRetry === true && (run.status === "failed" || run.status === "cancelled") && run.kind === "stage" && run.applicationId !== undefined;
  const abandonable =
    canAbandon === true && run.status === "succeeded" && canAbandonDocumentWrite(run.documentWrite) && run.abandonedAt === undefined;
  async function retry(fresh = false): Promise<void> {
    setBusy(true);
    try {
      const next = await jobRunsApi.retry(run.projectId, run.id, fresh ? { fresh: true } : {});
      toast.success(`Attempt ${next.attempt} queued`, retryNotice(next, fresh));
      onRetried?.(next);
      onChanged();
    } catch (error) {
      toast.error("Could not retry the run", error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {run.documentWrite?.prUrl === undefined ? null : (
          <a
            href={run.documentWrite.prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] text-accent hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
          >
            Pull request <ExternalLink className="size-3.5" />
          </a>
        )}
        {retryable ? (
          <>
            <Button size="small" variant="solid" disabled={busy} onClick={() => void retry()}>
              <RotateCcw />
              {busy ? "Queueing…" : "Retry run"}
            </Button>
            <Button size="small" className="shadow-border" disabled={busy} onClick={() => setConfirm("fresh")}>
              Retry from scratch
            </Button>
          </>
        ) : null}
        {canCancel && isActive(run) && run.cancelRequestedAt === undefined ? (
          <Button size="small" variant="danger" className="shadow-border" onClick={() => setConfirm("cancel")}>
            <Square />
            Cancel run
          </Button>
        ) : null}
        {abandonable ? (
          <Button size="small" className="shadow-border" onClick={() => setConfirm("abandon")}>
            <Undo2 />
            Release {scopeNoun}s
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "cancel" ? "Cancel this run?" : confirm === "fresh" ? "Retry from scratch?" : "Abandon this pull request?"}
        confirmLabel={confirm === "cancel" ? "Cancel run" : confirm === "fresh" ? "Retry from scratch" : "Abandon"}
        busyLabel="Working…"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm === "fresh") {
            await retry(true);
            return;
          }
          if (confirm === "cancel") {
            await jobRunsApi.cancel(run.projectId, run.id);
            toast.success("Cancellation requested");
          }
          if (confirm === "abandon") {
            await jobRunsApi.abandon(run.projectId, run.id);
            toast.success("Pull request abandoned", `Its ${scopeNoun}s can be selected again.`);
          }
          onChanged();
        }}
      >
        {confirm === "cancel"
          ? "The worker stops this run and its running processes. Its output will not be proposed to the document repository. The steps that finished are kept: Retry run continues from them."
          : confirm === "fresh"
            ? "Discard the step results kept in this run's workspace and start again from the same pinned source commits. A normal retry reuses completed steps when their inputs have not changed."
            : `Use this when the pull request was closed without merging. The ${run.scope?.items.length ?? 0} ${scopeNoun}s in its scope will be released for another run.`}
      </ConfirmDialog>
    </>
  );
}
