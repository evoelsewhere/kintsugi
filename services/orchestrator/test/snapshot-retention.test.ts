import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror, fetchMirror, resolveCommit } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GitSnapshotPins,
  pruneExpiredSnapshots,
  retainSnapshot,
  snapshotPinRef,
  type SnapshotRetentionRecord,
  type SnapshotRetentionRepository,
} from "../src/git-sync/retention.js";

class MemoryRetentionRepository implements SnapshotRetentionRepository {
  readonly records = new Map<string, SnapshotRetentionRecord>();

  async get(snapshotId: string): Promise<SnapshotRetentionRecord | undefined> {
    return this.records.get(snapshotId);
  }

  async listExpired(_now: Date): Promise<SnapshotRetentionRecord[]> {
    return [...this.records.values()].filter((record) => record.status === "ready");
  }

  async markReady(snapshotId: string): Promise<void> {
    const record = this.records.get(snapshotId);
    if (record !== undefined) record.status = "ready";
  }

  async markFailed(snapshotId: string, code: string): Promise<void> {
    const record = this.records.get(snapshotId);
    if (record !== undefined) {
      record.status = "failed";
      record.errorCode = code;
    }
  }

  async markExpired(snapshotId: string): Promise<void> {
    const record = this.records.get(snapshotId);
    if (record !== undefined) record.status = "expired";
  }
}

describe("worker-owned Coding Agent Workflow snapshot retention", () => {
  let remote: GitHttpServer;
  let dataDir: string;
  let storage: CheckoutStorage;
  let commitA: string;
  let records: MemoryRetentionRepository;
  let pins: GitSnapshotPins;
  const snapshotId = "ctx_00000000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-snapshot-retention-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    commitA = await remote.commit("docs", "README.md", "snapshot A\n");
    await cloneMirror(remote.baseUrl + "/docs.git", storage.mirror("local", "docs"), { allowHttp: true });
    records = new MemoryRetentionRepository();
    records.records.set(snapshotId, {
      snapshotId,
      status: "preparing",
      repositories: [{ repositoryId: "docs", commit: commitA }],
      expiresAt: "2026-10-21T00:00:00.000Z",
      leases: [],
    });
    pins = new GitSnapshotPins(storage, async (repositoryId) => ({ serverId: "local", repositoryId }));
  }, 180_000);

  afterAll(async () => {
    await remote?.close();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  });

  it("pins the exact commit idempotently, then releases only an expired unleased ref", async () => {
    expect(await retainSnapshot({ repository: records, pins }, snapshotId)).toMatchObject({ status: "ready", pinned: 1 });
    expect(await retainSnapshot({ repository: records, pins }, snapshotId)).toMatchObject({ status: "ready", pinned: 1 });
    const mirror = storage.mirror("local", "docs");
    expect(await resolveCommit(mirror, snapshotPinRef(snapshotId, "docs"))).toBe(commitA);

    const commitB = await remote.commit("docs", "README.md", "snapshot B\n");
    await fetchMirror(mirror, { allowHttp: true });
    expect(await resolveCommit(mirror, snapshotPinRef(snapshotId, "docs"))).toBe(commitA);
    expect(await resolveCommit(mirror, "refs/heads/main")).toBe(commitB);

    const result = await pruneExpiredSnapshots({ repository: records, pins }, new Date("2026-10-22T00:00:00.000Z"));
    expect(result).toMatchObject({ released: 1, retained: 0 });
    expect(records.records.get(snapshotId)?.status).toBe("expired");
    await expect(resolveCommit(mirror, snapshotPinRef(snapshotId, "docs"))).rejects.toThrow();
  });

  it("leaves transient pin errors retryable", async () => {
    const retryId = "ctx_00000000-0000-4000-8000-000000000004";
    records.records.set(retryId, {
      snapshotId: retryId,
      status: "preparing",
      repositories: [{ repositoryId: "docs", commit: commitA }],
      expiresAt: "2026-10-21T00:00:00.000Z",
      leases: [],
    });
    const transientPins = {
      retain: async () => { throw new Error("temporary mirror I/O failure"); },
      release: async () => undefined,
    };
    await expect(retainSnapshot({ repository: records, pins: transientPins }, retryId)).rejects.toThrow("temporary mirror I/O failure");
    expect(records.records.get(retryId)?.status).toBe("preparing");
    expect(records.records.get(retryId)?.errorCode).toBeUndefined();
  });

  it("keeps active leases and never substitutes HEAD when the pinned object is unavailable", async () => {
    const leasedId = "ctx_00000000-0000-4000-8000-000000000002";
    records.records.set(leasedId, {
      snapshotId: leasedId,
      status: "preparing",
      repositories: [{ repositoryId: "docs", commit: commitA }],
      expiresAt: "2026-10-19T00:00:00.000Z",
      leases: [{ expiresAt: null }],
    });
    const retained = await retainSnapshot({ repository: records, pins }, leasedId);
    expect(retained.status).toBe("ready");
    const prune = await pruneExpiredSnapshots({ repository: records, pins }, new Date("2026-10-22T00:00:00.000Z"));
    expect(prune.retained).toBe(1);
    expect(await resolveCommit(storage.mirror("local", "docs"), snapshotPinRef(leasedId, "docs"))).toBe(commitA);

    const missingId = "ctx_00000000-0000-4000-8000-000000000003";
    records.records.set(missingId, {
      snapshotId: missingId,
      status: "preparing",
      repositories: [{ repositoryId: "docs", commit: "f".repeat(40) }],
      expiresAt: "2026-10-21T00:00:00.000Z",
      leases: [],
    });
    const missing = await retainSnapshot({ repository: records, pins }, missingId);
    expect(missing.status).toBe("failed");
    expect(records.records.get(missingId)?.errorCode).toBe("SNAPSHOT_PIN_FAILED");
    expect(records.records.get(missingId)?.repositories[0]?.commit).toBe("f".repeat(40));
  });
});
