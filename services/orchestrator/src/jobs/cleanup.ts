// Job workspace cleanup (ADR-0029). A top-level run leaves only <data>/jobs/<id>/out behind,
// for the document repo writer (a failed stage also its work/, so it can be resumed, ADR-0033). It is deleted as soon as the write of that output reaches a
// final state (committed, pr-opened, merged, closed, unchanged). Outputs of failed or cancelled runs and of
// failed writes stay for a retention period (KINTSUGI_JOB_RETENTION_DAYS, default 7) so they can
// be inspected or the write retried; a periodic sweep of the worker removes them afterwards,
// along with workspaces no run refers to any more.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CheckoutStorage } from "@kintsugi/git";
import { removeTree } from "@kintsugi/runtime/launcher";

/** Document write statuses after which a job's output is no longer needed. */
export const FINAL_WRITE_STATUSES: readonly string[] = ["committed", "pr-opened", "merged", "closed", "unchanged"];

export const DEFAULT_JOB_RETENTION_DAYS = 7;

/** What the sweep needs to know about the run behind a workspace. */
export interface WorkspaceState {
  status: string;
  finishedAt?: Date;
  /** Status of the document write of the run's output, if any. */
  writeStatus?: string;
}

export interface WorkspaceStates {
  /** States of the given runs; unknown ids are missing from the map. */
  workspaceStates(ids: readonly string[]): Promise<Map<string, WorkspaceState>>;
}

/** Removes a job's workspace (its out/ and anything left beside it). */
export async function removeJobWorkspace(storage: CheckoutStorage, jobId: string): Promise<void> {
  await removeTree(storage.job(jobId).root);
}

export interface PruneOptions {
  storage: CheckoutStorage;
  store: WorkspaceStates;
  retentionMs: number;
  now?: Date;
}

const ACTIVE = new Set(["queued", "running"]);

/** Deletes expired job workspaces; returns the ids removed. Workspaces of active runs are kept. */
export async function pruneJobWorkspaces(options: PruneOptions): Promise<string[]> {
  const jobsDir = join(options.storage.root, "jobs");
  const ids = await readdir(jobsDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  if (ids.length === 0) return [];
  const states = await options.store.workspaceStates(ids);
  const cutoff = (options.now ?? new Date()).getTime() - options.retentionMs;
  const removed: string[] = [];
  for (const id of ids) {
    const state = states.get(id);
    let expired: boolean;
    if (state === undefined) {
      // No run refers to it (a deleted project, an interrupted test): by its age.
      const modified = await stat(join(jobsDir, id)).then((entry) => entry.mtimeMs, () => undefined);
      expired = modified !== undefined && modified < cutoff;
    } else if (ACTIVE.has(state.status)) {
      expired = false;
    } else if (state.writeStatus !== undefined && FINAL_WRITE_STATUSES.includes(state.writeStatus)) {
      expired = true;
    } else if (state.writeStatus === "queued") {
      // The writer has not run yet (or is retrying): never take its input away.
      expired = false;
    } else {
      expired = (state.finishedAt?.getTime() ?? 0) < cutoff;
    }
    if (!expired) continue;
    try {
      await removeJobWorkspace(options.storage, id);
      removed.push(id);
    } catch {
      // Next sweep.
    }
  }
  return removed;
}
