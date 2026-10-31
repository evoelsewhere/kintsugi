// Job workspace cleanup (ADR-0029, ADR-0055, ADR-0090). A job workspace outlives its attempts. What can be made again
// from the pins in its manifest (the checkouts of the repositories, the documents) and the unfinished output of a
// step (steps/) go first: at once when an attempt ends well, and after `KINTSUGI_JOB_CHECKOUT_HOURS` for a job that
// failed or was cancelled (dropExpiredCheckouts). What cannot (out/, work/, .state/) stays for the retries of a failed
// or cancelled job and for the document repo writer: out/ is deleted as soon as the write of that output reaches a
// final state (committed, pr-opened, merged, closed, unchanged). Outputs of failed or cancelled runs and of failed
// writes stay for a retention period (KINTSUGI_JOB_RETENTION_DAYS, default 7) so they can be inspected, the job
// retried or the write retried; a periodic sweep of the worker removes them afterwards, along with workspaces no run
// refers to.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CheckoutStorage } from "@kintsugi/git";
import { removeTree } from "@kintsugi/runtime/launcher";
import { readManifest } from "../workspace/manifest.js";
import { dropCheckouts } from "../workspace/provision.js";
import type { SourceCheckouts } from "./model.js";

/** Document write statuses after which a job's output is no longer needed. */
export const FINAL_WRITE_STATUSES: readonly string[] = ["committed", "pr-opened", "merged", "closed", "unchanged"];

export const DEFAULT_JOB_RETENTION_DAYS = 7;
/** Hours the checkouts of a failed job are kept for a retry before the sweep drops them. */
export const DEFAULT_JOB_CHECKOUT_HOURS = 24;

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

/** Why a workspace cannot be removed on request, or undefined when it can: the run is active, or its output is not written yet. */
export function removalBlocker(state: WorkspaceState | undefined): string | undefined {
  if (state === undefined) return undefined;
  if (ACTIVE.has(state.status)) return `its run is ${state.status}`;
  if (state.writeStatus === "queued") return "the document write of its output has not run yet";
  return undefined;
}

export type RemovalOutcome = "removed" | "missing" | "busy";

/**
 * Removes one workspace at an admin's request (ADR-0058). The state of the run is read again here, in the process that
 * owns the disk: a run that started after the request was made is never taken from under its processes.
 */
export async function removeWorkspaceOnRequest(options: { storage: CheckoutStorage; store: WorkspaceStates; jobId: string }): Promise<RemovalOutcome> {
  const root = options.storage.job(options.jobId).root;
  if (!(await stat(root).then((entry) => entry.isDirectory(), () => false))) return "missing";
  const state = (await options.store.workspaceStates([options.jobId])).get(options.jobId);
  if (removalBlocker(state) !== undefined) return "busy";
  await removeJobWorkspace(options.storage, options.jobId);
  return "removed";
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

export interface DropCheckoutsOptions {
  storage: CheckoutStorage;
  store: WorkspaceStates;
  checkouts: SourceCheckouts;
  checkoutMs: number;
  now?: Date;
}

/**
 * Drops the checkouts of the jobs that failed (or were cancelled) more than `checkoutMs` ago: the next attempt of a
 * job makes them again from the pins in its manifest. Returns the ids dropped; a job already dropped is skipped.
 */
export async function dropExpiredCheckouts(options: DropCheckoutsOptions): Promise<string[]> {
  const jobsDir = join(options.storage.root, "jobs");
  const ids = await readdir(jobsDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  if (ids.length === 0) return [];
  const states = await options.store.workspaceStates(ids);
  const cutoff = (options.now ?? new Date()).getTime() - options.checkoutMs;
  const dropped: string[] = [];
  for (const id of ids) {
    const state = states.get(id);
    if (state === undefined || ACTIVE.has(state.status) || state.finishedAt === undefined || state.finishedAt.getTime() >= cutoff) continue;
    const paths = options.storage.job(id);
    const manifest = await readManifest(paths.manifest);
    if (manifest === undefined || manifest.checkoutsDroppedAt !== undefined) continue;
    try {
      await dropCheckouts(options.checkouts, paths, manifest);
      dropped.push(id);
    } catch {
      // Next sweep.
    }
  }
  return dropped;
}
