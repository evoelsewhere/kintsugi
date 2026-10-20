// Snapshot refs keep exact document commits reachable until expiry and all leases end.

import { createHash } from "node:crypto";
import { CheckoutStorage, GitError, resolveCommit, runGit } from "@kintsugi/git";
import { withMirrorLock } from "./sync.js";

export interface SnapshotRepositoryPin {
  serverId: string;
  repositoryId: string;
  commit: string;
}

export interface SnapshotLease {
  expiresAt: string | null;
}

export interface SnapshotRetentionRecord {
  snapshotId: string;
  status: "preparing" | "ready" | "failed" | "expiring" | "expired";
  repositories: SnapshotRepositoryPin[];
  expiresAt: string;
  leases: SnapshotLease[];
  errorCode?: string;
}

/** Operations that reuse the connection holding a snapshot's session advisory lock. */
export interface SnapshotRetentionSession {
  get(snapshotId: string): Promise<SnapshotRetentionRecord | undefined>;
  markReady(snapshotId: string): Promise<boolean>;
  markFailed(snapshotId: string, code: string): Promise<void>;
  markExpired(snapshotId: string): Promise<void>;
}

export interface SnapshotRetentionRepository extends SnapshotRetentionSession {
  claimExpired(): Promise<{ snapshots: SnapshotRetentionRecord[]; retained: number }>;
  claimStalePreparing(): Promise<SnapshotRetentionRecord[]>;
  withSnapshotLock<T>(snapshotId: string, work: (repository: SnapshotRetentionSession) => Promise<T>): Promise<T>;
}

export interface SnapshotPins {
  /** Returns true only when this call created the ref; false means it already matched. */
  retain(snapshotId: string, pin: SnapshotRepositoryPin): Promise<boolean>;
  release(snapshotId: string, pin: SnapshotRepositoryPin): Promise<void>;
}

export interface SnapshotRetentionDependencies {
  repository: SnapshotRetentionRepository;
  pins: SnapshotPins;
}

export interface RetentionResult {
  status: "ready" | "failed" | "expired" | "missing";
  pinned: number;
  errorCode?: string;
}

export interface CleanupResult {
  released: number;
  retained: number;
}

export class SnapshotObjectUnavailableError extends Error {
  constructor() {
    super("snapshot commit is not available in its registered Git mirror");
    this.name = "SnapshotObjectUnavailableError";
  }
}

const SNAPSHOT_ID = /^ctx_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FULL_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const runOptions = { timeoutMs: 30_000 };

/** Stable, safe local ref for one snapshot and one registered repository. */
export function snapshotPinRef(snapshotId: string, repositoryId: string): string {
  validateSnapshotId(snapshotId);
  if (repositoryId.trim() === "" || repositoryId.length > 200) throw new TypeError("repositoryId is invalid");
  const repositoryKey = createHash("sha256").update(repositoryId, "utf8").digest("hex").slice(0, 24);
  return `refs/kintsugi/snapshots/${snapshotId}/${repositoryKey}`;
}

/** A local Git ref writer; all mutations run under the same per-repository mirror lock as sync. */
export class GitSnapshotPins implements SnapshotPins {
  constructor(private readonly storage: CheckoutStorage) {}

  async retain(snapshotId: string, pin: SnapshotRepositoryPin): Promise<boolean> {
    const ref = snapshotPinRef(snapshotId, pin.repositoryId);
    validateCommit(pin.commit);
    return withMirrorLock(pin.repositoryId, async () => {
      const mirror = this.storage.mirror(pin.serverId, pin.repositoryId);
      let resolved: string;
      try {
        resolved = await resolveCommit(mirror, pin.commit);
      } catch (error) {
        if (error instanceof GitError && error.exitCode === 128) throw new SnapshotObjectUnavailableError();
        throw error;
      }
      if (resolved !== pin.commit) throw new Error("snapshot commit resolved to a different Git object");
      const existing = await this.refCommit(mirror, ref);
      if (existing === pin.commit) return false;
      if (existing !== undefined) throw new Error("snapshot pin already refers to a different commit");

      const format = (await runGit(["--git-dir", mirror, "rev-parse", "--show-object-format"], runOptions)).stdout.trim();
      const zero = "0".repeat(format === "sha256" ? 64 : 40);
      try {
        await runGit(["--git-dir", mirror, "update-ref", ref, pin.commit, zero], runOptions);
        return true;
      } catch (error) {
        // Another worker may have created the same idempotent ref after our read.
        if (await this.refCommit(mirror, ref) === pin.commit) return false;
        throw error;
      }
    });
  }

  async release(snapshotId: string, pin: SnapshotRepositoryPin): Promise<void> {
    const ref = snapshotPinRef(snapshotId, pin.repositoryId);
    validateCommit(pin.commit);
    await withMirrorLock(pin.repositoryId, async () => {
      const mirror = this.storage.mirror(pin.serverId, pin.repositoryId);
      const existing = await this.refCommit(mirror, ref);
      if (existing === undefined) return;
      if (existing !== pin.commit) throw new Error("snapshot pin changed before release");
      await runGit(["--git-dir", mirror, "update-ref", "-d", ref, pin.commit], runOptions);
    });
  }

  private async refCommit(mirror: string, ref: string): Promise<string | undefined> {
    try {
      const result = await runGit(["--git-dir", mirror, "rev-parse", "--verify", "-q", "--end-of-options", `${ref}^{commit}`], runOptions);
      return result.stdout.trim();
    } catch (error) {
      if (error instanceof GitError && (error.exitCode === 1 || error.exitCode === 128)) return undefined;
      throw error;
    }
  }
}

/** Pins every repository before exposing the immutable snapshot as ready. */
export async function retainSnapshot(deps: SnapshotRetentionDependencies, snapshotId: string): Promise<RetentionResult> {
  validateSnapshotId(snapshotId);
  return deps.repository.withSnapshotLock(snapshotId, (repository) => retainSnapshotLocked({ ...deps, repository }, snapshotId));
}

async function retainSnapshotLocked(deps: { repository: SnapshotRetentionSession; pins: SnapshotPins }, snapshotId: string): Promise<RetentionResult> {
  const snapshot = await deps.repository.get(snapshotId);
  if (snapshot === undefined) return { status: "missing", pinned: 0 };
  if (snapshot.status === "expired" || snapshot.status === "expiring") return { status: "expired", pinned: 0 };
  if (snapshot.status === "failed") return { status: "failed", pinned: 0, ...(snapshot.errorCode === undefined ? {} : { errorCode: snapshot.errorCode }) };
  if (snapshot.status === "ready") return { status: "ready", pinned: snapshot.repositories.length };
  if (snapshot.repositories.length === 0) {
    await deps.repository.markFailed(snapshotId, "SNAPSHOT_PIN_FAILED");
    return { status: "failed", pinned: 0, errorCode: "SNAPSHOT_PIN_FAILED" };
  }

  const created: SnapshotRepositoryPin[] = [];
  try {
    for (const pin of snapshot.repositories) {
      if (await deps.pins.retain(snapshotId, pin)) created.push(pin);
    }
    if (!(await deps.repository.markReady(snapshotId))) {
      await releaseSnapshotPins(deps, snapshot);
      await deps.repository.markFailed(snapshotId, "SNAPSHOT_PREPARATION_EXPIRED");
      return { status: "failed", pinned: 0, errorCode: "SNAPSHOT_PREPARATION_EXPIRED" };
    }
    return { status: "ready", pinned: snapshot.repositories.length };
  } catch (error) {
    for (const pin of created.reverse()) await deps.pins.release(snapshotId, pin).catch(() => undefined);
    if (error instanceof SnapshotObjectUnavailableError) {
      await releaseSnapshotPins(deps, snapshot);
      await deps.repository.markFailed(snapshotId, "SNAPSHOT_PIN_FAILED");
      return { status: "failed", pinned: 0, errorCode: "SNAPSHOT_PIN_FAILED" };
    }
    throw error;
  }
}

async function releaseSnapshotPins(
  deps: { pins: SnapshotPins },
  snapshot: SnapshotRetentionRecord,
): Promise<void> {
  for (const pin of snapshot.repositories) await deps.pins.release(snapshot.snapshotId, pin);
}

export interface SnapshotRecoveryResult {
  attempted: number;
  ready: number;
  failed: number;
  retryable: number;
}

/** Recovers preparing snapshots after queue retry exhaustion, with durable backoff in Postgres. */
export async function recoverStaleSnapshots(
  deps: SnapshotRetentionDependencies,
): Promise<SnapshotRecoveryResult> {
  const candidates = await deps.repository.claimStalePreparing();
  const result: SnapshotRecoveryResult = { attempted: candidates.length, ready: 0, failed: 0, retryable: 0 };
  for (const candidate of candidates) {
    try {
      const retained = await retainSnapshot(deps, candidate.snapshotId);
      if (retained.status === "ready") result.ready += 1;
      else if (retained.status === "failed") result.failed += 1;
    } catch {
      result.retryable += 1;
    }
  }
  return result;
}


/** Releases refs only after expiry and every active review/evidence lease have ended. */
export async function pruneExpiredSnapshots(deps: SnapshotRetentionDependencies): Promise<CleanupResult> {
  const claimed = await deps.repository.claimExpired();
  const result: CleanupResult = { released: 0, retained: claimed.retained };
  for (const snapshot of claimed.snapshots) {
    for (const pin of snapshot.repositories) await deps.pins.release(snapshot.snapshotId, pin);
    await deps.repository.markExpired(snapshot.snapshotId);
    result.released += 1;
  }
  return result;
}

function validateSnapshotId(snapshotId: string): void {
  if (!SNAPSHOT_ID.test(snapshotId)) throw new TypeError("snapshotId is invalid");
}

function validateCommit(commit: string): void {
  if (!FULL_COMMIT.test(commit)) throw new TypeError("snapshot commit must be a full Git object id");
}
