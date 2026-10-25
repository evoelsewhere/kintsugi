// Monitoring → Runtime (ADR-0058): the job workspaces on the worker's data volume, each with its run, its state, what it
// holds that a retry cannot make again, and when the sweep removes it. An admin (sandbox.manage) removes one that is
// no longer needed; the worker deletes it, and never one whose run is active or whose output is not written yet.

import { Box, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { RunStatusBadge, StatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { type SandboxWorkspace, monitoringApi } from "@/lib/api/monitoring";
import { useAuth } from "@/lib/auth";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import { deliveryLink } from "@/lib/links";
import { useLoader } from "@/lib/use-loader";
import { formatCount } from "./delivery/results/results-format";
import { Kpi, KpiRow } from "./delivery/results/results-parts";

const LIFECYCLE_NOTE: Record<string, string> = {
  running: "An attempt is running",
  parked: "The job failed and can be retried from what it kept",
  published: "Only its output is still needed, for the document write",
};

/** When the sweep removes a workspace, in words. */
function removal(workspace: SandboxWorkspace): string {
  if (workspace.removalAt === undefined) return "kept while it is needed";
  const hours = Math.round((new Date(workspace.removalAt).getTime() - Date.now()) / (60 * 60 * 1000));
  if (hours <= 0) return "due at the next sweep";
  return hours < 48 ? `in ${hours} h` : `in ${Math.round(hours / 24)} days`;
}

const size = (workspace: SandboxWorkspace): string => (workspace.resultsBytes === undefined ? "—" : `${workspace.resultsBytesTruncated === true ? "≥ " : ""}${formatBytes(workspace.resultsBytes)}`);

export function SandboxView(): React.JSX.Element {
  const { can } = useAuth();
  const toast = useToast();
  const [asked, setAsked] = useState<SandboxWorkspace | null>(null);
  const list = useLoader("monitoring-sandbox", monitoringApi.sandboxWorkspaces, { live: ["job-runs"], refresh: () => 30000 });
  const canRemove = can("sandbox.manage");

  const workspaces = list.data?.workspaces ?? [];
  const active = workspaces.filter((entry) => entry.run?.status === "running" || entry.run?.status === "queued").length;
  const bytes = workspaces.reduce((sum, entry) => sum + (entry.resultsBytes ?? 0), 0);
  const withCheckouts = workspaces.filter((entry) => entry.hasCheckouts).length;

  async function remove(workspace: SandboxWorkspace): Promise<void> {
    await monitoringApi.removeSandboxWorkspace(workspace.jobId);
    toast.success("Removal queued", `The worker deletes the workspace of ${workspace.jobId.slice(0, 8)} within a few seconds.`);
    // The worker deletes it on its own time: look again shortly.
    setTimeout(() => void list.reload(), 3000);
  }

  return (
    <div className="flex flex-col gap-4">
      {list.data === undefined ? null : (
        <KpiRow>
          <Kpi label="Workspaces" value={workspaces.length} hint="on the data volume" />
          <Kpi label="Active" value={active} tone={active > 0 ? "blue" : undefined} hint="their run is queued or running" />
          <Kpi label="With checkouts" value={withCheckouts} hint="the old and the new code, made again by a retry" />
          <Kpi label="Results" value={undefined} display={formatBytes(bytes)} hint="what a retry cannot make again" />
        </KpiRow>
      )}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Job workspaces</CardTitle>
            <CardDescription>
              One per job, kept across its attempts. The sweep removes them after {list.data?.retentionDays ?? 7} days (Settings → Sandbox & Agent), or at once when the write of their output has landed.
              {canRemove ? " Remove one earlier to free its disk." : ""}
            </CardDescription>
          </div>
          <Button size="icon" variant="ghost" aria-label="Refresh the workspaces" onClick={() => void list.reload()}>
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <div className="mt-2">
          <Loaded loader={list} rows={4}>
            {(loaded) =>
              loaded.workspaces.length === 0 ? (
                <EmptyState icon={Box} title="No job workspace on disk" description="A workspace appears when a job starts, and goes when its output is written or after the retention period." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-[13px]">
                    <thead className="text-[11px] tracking-wide text-text-muted uppercase">
                      <tr>
                        <th className="py-1.5 pr-2 font-normal">Job</th>
                        <th className="px-2 py-1.5 font-normal">Run</th>
                        <th className="px-2 py-1.5 font-normal">State</th>
                        <th className="px-2 py-1.5 font-normal">Checkouts</th>
                        <th className="px-2 py-1.5 text-right font-normal">Results</th>
                        <th className="px-2 py-1.5 font-normal">Removed</th>
                        <th className="py-1.5 pl-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {loaded.workspaces.map((workspace) => (
                        <WorkspaceRow key={workspace.jobId} workspace={workspace} canRemove={canRemove} onRemove={() => setAsked(workspace)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </Loaded>
        </div>
      </Card>

      <ConfirmDialog
        open={asked !== null}
        title="Remove this workspace?"
        description={asked === null ? undefined : `Job ${asked.jobId}`}
        confirmLabel="Remove workspace"
        busyLabel="Asking the worker…"
        onConfirm={() => (asked === null ? Promise.resolve() : remove(asked))}
        onClose={() => setAsked(null)}
      >
        <p>
          The worker deletes the whole folder: the checkouts, what the steps wrote and the state a retry reuses. A failed job can still be retried, but it begins from nothing again.
          {asked?.run?.status === "failed" || asked?.lifecycle === "parked" ? "" : " Its results are lost if their document write has not landed."}
        </p>
      </ConfirmDialog>
    </div>
  );
}

function WorkspaceRow({ workspace, canRemove, onRemove }: { workspace: SandboxWorkspace; canRemove: boolean; onRemove: () => void }): React.JSX.Element {
  const run = workspace.run;
  const link = run === undefined || run.kind !== "stage" ? undefined : deliveryLink({ projectId: run.projectId, applicationId: run.applicationId, stage: run.name, runId: workspace.jobId });
  return (
    <tr className="align-top [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
      <td className="py-2 pr-2">
        <p className="font-mono text-[12px] text-text" title={workspace.jobId}>
          {workspace.jobId.length > 18 ? `${workspace.jobId.slice(0, 8)}…` : workspace.jobId}
        </p>
        <p className="text-[11px] text-text-muted" title={formatDateTime(workspace.modifiedAt)}>
          changed {formatRelative(workspace.modifiedAt)}
        </p>
      </td>
      <td className="px-2 py-2">
        {run === undefined ? (
          <span className="text-[12px] text-text-muted" title="No run in the database refers to this folder">
            no run
          </span>
        ) : (
          <>
            <p className="text-text">
              {link === undefined ? (
                run.name
              ) : (
                <Link className="underline-offset-2 hover:underline" to={link}>
                  {run.name}
                </Link>
              )}
              {run.attempt > 1 ? <span className="text-text-muted"> · attempt {run.attempt}</span> : null}
            </p>
            <p className="text-[11px] text-text-muted">
              {run.projectId}
              {run.applicationId === undefined ? "" : ` / ${run.applicationId}`}
            </p>
          </>
        )}
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {run === undefined ? null : <RunStatusBadge status={run.status} />}
          {workspace.lifecycle === undefined ? null : <StatusBadge tone="muted" label={workspace.lifecycle} title={LIFECYCLE_NOTE[workspace.lifecycle]} />}
        </div>
        {workspace.blockedBy === undefined ? null : <p className="mt-1 text-[11px] text-text-muted">{workspace.blockedBy}</p>}
      </td>
      <td className="px-2 py-2 text-[12px] text-text-secondary" title={workspace.sources.join("\n")}>
        {workspace.hasCheckouts ? `${formatCount(workspace.sources.length)} repositor${workspace.sources.length === 1 ? "y" : "ies"}` : "dropped"}
      </td>
      <td className="px-2 py-2 text-right text-[12px] text-text-secondary tabular-nums">{size(workspace)}</td>
      <td className="px-2 py-2 text-[12px] text-text-secondary" title={workspace.removalAt === undefined ? undefined : formatDateTime(workspace.removalAt)}>
        {removal(workspace)}
      </td>
      <td className="py-2 pl-2 text-right">
        {canRemove ? (
          <Button size="icon" variant="danger" aria-label={`Remove the workspace of ${workspace.jobId}`} title={workspace.blockedBy === undefined ? "Remove this workspace" : `Cannot be removed: ${workspace.blockedBy}`} disabled={workspace.blockedBy !== undefined} onClick={onRemove}>
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </td>
    </tr>
  );
}
