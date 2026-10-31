// Domain of the sandbox view (ADR-0058): the job workspaces on the worker's data volume and what the database says about
// the run behind each. Pure types and the removal rule — no framework, no I/O.

/** `running`: an attempt is running. `parked`: the job failed or was cancelled and can be retried. `published`: only its output is still needed. */
export type WorkspaceLifecycle = "running" | "parked" | "published";

/** What the disk says about one workspace (its manifest, when it has a readable one). */
export interface DiskWorkspace {
  /** The folder name: the job (run) id. */
  jobId: string;
  modifiedAt: string;
  lifecycle?: WorkspaceLifecycle;
  attempt?: number;
  /** The repositories it mounts, `<role>:<repository id>@<short commit>`. */
  sources: string[];
  /** Whether the checkouts (as-is/, to-be/, docs/) are still on disk; they are made again by a retry. */
  hasCheckouts: boolean;
  /** Bytes of what cannot be made again (everything but the checkouts); undefined when it was not measured. */
  resultsBytes?: number;
  /** The measure stopped at its limit: the real size is larger. */
  resultsBytesTruncated?: boolean;
}

/** What the database says about the run a workspace belongs to. */
export interface RunState {
  projectId: string;
  applicationId?: string;
  kind: string;
  name: string;
  status: string;
  attempt: number;
  createdAt: string;
  finishedAt?: string;
  /** Status of the document write of its output, when there is one. */
  writeStatus?: string;
}

export interface WorkspaceView extends DiskWorkspace {
  run?: RunState;
  /** The sweep removes it from this time (retention for the output of a failed run; at once once its write landed). */
  removalAt?: string;
  /** Why an admin cannot remove it now; undefined when it can be removed. */
  blockedBy?: string;
}

/** Document write statuses after which a job's output is no longer needed (mirrors the worker's cleanup). */
export const FINAL_WRITE_STATUSES: readonly string[] = ["committed", "pr-opened", "merged", "closed", "unchanged"];

/**
 * Why a workspace cannot be removed on request, or undefined when it can: its run is active, or the document write of
 * its output has not run yet. The worker checks the same rule again before it deletes anything.
 */
export function removalBlocker(run: Pick<RunState, "status" | "writeStatus"> | undefined): string | undefined {
  if (run === undefined) return undefined;
  if (run.status === "queued" || run.status === "running") return `its run is ${run.status}`;
  if (run.writeStatus === "queued") return "the document write of its output has not run yet";
  return undefined;
}

/** When the sweep removes a workspace; undefined while it is needed (an active run or a pending write). */
export function removalTime(run: RunState | undefined, modifiedAt: string, retentionDays: number, now: Date = new Date()): string | undefined {
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  if (run === undefined) return new Date(new Date(modifiedAt).getTime() + retentionMs).toISOString();
  if (removalBlocker(run) !== undefined) return undefined;
  if (run.writeStatus !== undefined && FINAL_WRITE_STATUSES.includes(run.writeStatus)) return now.toISOString();
  return new Date(new Date(run.finishedAt ?? modifiedAt).getTime() + retentionMs).toISOString();
}

/** The job workspaces on the data volume (read-only: the API cannot write it). */
export abstract class WorkspaceDisk {
  abstract list(): Promise<DiskWorkspace[]>;
  abstract exists(jobId: string): Promise<boolean>;
}

/** The runs behind workspaces. */
export abstract class WorkspaceRuns {
  abstract states(jobIds: readonly string[]): Promise<Map<string, RunState>>;
}

/** Asks the worker, which owns the disk, to remove one workspace. */
export abstract class WorkspaceRemovals {
  abstract request(jobId: string, actor: string): Promise<void>;
}

export const JOB_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
