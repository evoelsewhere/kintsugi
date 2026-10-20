import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror, fetchMirror, resolveCommit } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GitSnapshotPins,
  SnapshotObjectUnavailableError,
  pruneExpiredSnapshots,
  recoverStaleSnapshots,
  retainSnapshot,
  snapshotPinRef,
  type SnapshotRetentionRecord,
  type SnapshotRetentionRepository,
  type SnapshotRetentionSession,
} from "../src/git-sync/retention.js";

class MemoryRetentionRepository implements SnapshotRetentionRepository {
  readonly records = new Map<string, SnapshotRetentionRecord>();
  databaseNow = new Date("2026-10-20T00:00:00.000Z");

  async get(snapshotId: string): Promise<SnapshotRetentionRecord | undefined> {
    return this.records.get(snapshotId);
  }

  async withSnapshotLock<T>(_snapshotId: string, work: (repository: SnapshotRetentionSession) => Promise<T>): Promise<T> {
    return work(this);
  }

  async claimStalePreparing(): Promise<SnapshotRetentionRecord[]> {
    return [...this.records.values()].filter((record) => record.status === "preparing");
  }

  async claimExpired(): Promise<{ snapshots: SnapshotRetentionRecord[]; retained: number }> {
    const snapshots: SnapshotRetentionRecord[] = [];
    let retained = 0;
    for (const record of this.records.values()) {
      if (record.status === "expiring") {
        snapshots.push(record);
        continue;
      }
      if (record.status !== "ready" || Date.parse(record.expiresAt) > this.databaseNow.getTime()) continue;
      if (record.leases.some((lease) => lease.expiresAt === null || Date.parse(lease.expiresAt) > this.databaseNow.getTime())) {
        retained += 1;
        continue;
      }
      record.status = "expiring";
      snapshots.push(record);
    }
    return { snapshots, retained };
  }

  async markReady(snapshotId: string): Promise<boolean> {
    const record = this.records.get(snapshotId);
    if (record === undefined || record.status !== "preparing" || Date.parse(record.expiresAt) <= this.databaseNow.getTime()) {
      return false;
    }
    record.status = "ready";
    return true;
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
      repositories: [{ serverId: "local", repositoryId: "docs", commit: commitA }],
      expiresAt: "2026-10-21T00:00:00.000Z",
      leases: [],
    });
    pins = new GitSnapshotPins(storage);
  }, 180_000);

  beforeEach(() => {
    records.databaseNow = new Date("2026-10-20T00:00:00.000Z");
  });

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

    records.databaseNow = new Date("2026-10-22T00:00:00.000Z");
    const result = await pruneExpiredSnapshots({ repository: records, pins });
    expect(result).toMatchObject({ released: 1, retained: 0 });
    expect(records.records.get(snapshotId)?.status).toBe("expired");
    await expect(resolveCommit(mirror, snapshotPinRef(snapshotId, "docs"))).rejects.toThrow();
  });

  it("resumes an expiry after ref release fails partway through", async () => {
    const recoveringId = "ctx_00000000-0000-4000-8000-000000000005";
    records.records.set(recoveringId, {
      snapshotId: recoveringId,
      status: "ready",
      repositories: [{ serverId: "local", repositoryId: "docs", commit: commitA }],
      expiresAt: "2026-10-19T00:00:00.000Z",
      leases: [],
    });
    let attempts = 0;
    const interruptedPins = {
      retain: async () => false,
      release: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary ref deletion failure");
      },
    };
    const deps = { repository: records, pins: interruptedPins };
    records.databaseNow = new Date("2026-10-22T00:00:00.000Z");
    await expect(pruneExpiredSnapshots(deps))
      .rejects.toThrow("temporary ref deletion failure");
    expect(records.records.get(recoveringId)?.status).toBe("expiring");

    const resumed = await pruneExpiredSnapshots(deps);
    expect(resumed.released).toBe(1);
    expect(records.records.get(recoveringId)?.status).toBe("expired");
    expect(attempts).toBe(2);
  });

  it("recovers a preparing snapshot after its retention queue retries are exhausted", async () => {
    const exhaustedId = "ctx_00000000-0000-4000-8000-000000000006";
    records.records.set(exhaustedId, {
      snapshotId: exhaustedId,
      status: "preparing",
      repositories: [{ serverId: "local", repositoryId: "docs", commit: commitA }],
      expiresAt: "2026-10-21T00:00:00.000Z",
      leases: [],
    });
    let failFirst = true;
    const retryablePins = {
      retain: async () => {
        if (failFirst) throw new Error("temporary mirror I/O failure");
        return true;
      },
      release: async () => undefined,
    };
    const deps = { repository: records, pins: retryablePins };
    await expect(retainSnapshot(deps, exhaustedId)).rejects.toThrow("temporary mirror I/O failure");
    failFirst = false;

    const recovered = await recoverStaleSnapshots(deps);
    expect(recovered).toEqual({ attempted: 1, ready: 1, failed: 0, retryable: 0 });
    expect(records.records.get(exhaustedId)?.status).toBe("ready");
  });

  it("does not fail a preparing snapshot when the worker clock is ahead of Postgres", async () => {
    const aheadId = "ctx_00000000-0000-4000-8000-000000000011";
    records.databaseNow = new Date("2026-10-20T00:00:00.000Z");
    records.records.set(aheadId, {
      snapshotId: aheadId,
      status: "preparing",
      repositories: [{ serverId: "local", repositoryId: "docs", commit: commitA }],
      expiresAt: "2026-10-21T00:00:00.000Z",
      leases: [],
    });
    const deps = { repository: records, pins: { retain: async () => true, release: async () => undefined } };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T00:00:00.000Z"));
    try {
      const result = await retainSnapshot(deps, aheadId);

      expect(result.status).toBe("ready");
      expect(records.records.get(aheadId)?.status).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases pins and fails preparation when Postgres expiry has passed but the worker clock is behind", async () => {
    const behindId = "ctx_00000000-0000-4000-8000-000000000012";
    records.databaseNow = new Date("2026-10-22T00:00:00.000Z");
    records.records.set(behindId, {
      snapshotId: behindId,
      status: "preparing",
      repositories: [{ serverId: "local", repositoryId: "docs", commit: commitA }],
      expiresAt: "2026-10-21T00:00:00.000Z",
      leases: [],
    });
    const released: string[] = [];
    const deps = {
      repository: records,
      pins: {
        retain: async () => true,
        release: async (_snapshot: string, pin: { repositoryId: string }) => { released.push(pin.repositoryId); },
      },
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T00:00:00.000Z"));
    try {
      const result = await retainSnapshot(deps, behindId);

      expect(result).toMatchObject({ status: "failed", errorCode: "SNAPSHOT_PREPARATION_EXPIRED" });
      expect(released).toContain("docs");
      expect(records.records.get(behindId)?.status).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases refs left by an earlier retry before permanently failing a snapshot", async () => {
    const unavailableId = "ctx_00000000-0000-4000-8000-000000000007";
    records.records.set(unavailableId, {
      snapshotId: unavailableId,
      status: "preparing",
      repositories: [
        { serverId: "local", repositoryId: "docs-a", commit: commitA },
        { serverId: "local", repositoryId: "docs-b", commit: commitA },
      ],
      expiresAt: "2026-10-21T00:00:00.000Z",
      leases: [],
    });
    const released: string[] = [];
    const unavailablePins = {
      retain: async (_snapshot: string, pin: { repositoryId: string }) => {
        if (pin.repositoryId === "docs-a") return false;
        throw new SnapshotObjectUnavailableError();
      },
      release: async (_snapshot: string, pin: { repositoryId: string }) => { released.push(pin.repositoryId); },
    };

    const result = await retainSnapshot({ repository: records, pins: unavailablePins }, unavailableId);

    expect(result).toMatchObject({ status: "failed", errorCode: "SNAPSHOT_PIN_FAILED" });
    expect(released).toContain("docs-a");
    expect(records.records.get(unavailableId)?.status).toBe("failed");
  });

  it("leaves transient pin errors retryable", async () => {
    const retryId = "ctx_00000000-0000-4000-8000-000000000004";
    records.records.set(retryId, {
      snapshotId: retryId,
      status: "preparing",
      repositories: [{ serverId: "local", repositoryId: "docs", commit: commitA }],
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
      repositories: [{ serverId: "local", repositoryId: "docs", commit: commitA }],
      expiresAt: "2026-10-21T00:00:00.000Z",
      leases: [{ expiresAt: null }],
    });
    const retained = await retainSnapshot({ repository: records, pins }, leasedId);
    expect(retained.status).toBe("ready");
    records.records.get(leasedId)!.expiresAt = "2026-10-19T00:00:00.000Z";
    records.databaseNow = new Date("2026-10-22T00:00:00.000Z");
    const prune = await pruneExpiredSnapshots({ repository: records, pins });
    expect(prune.retained).toBe(1);
    expect(await resolveCommit(storage.mirror("local", "docs"), snapshotPinRef(leasedId, "docs"))).toBe(commitA);

    const missingId = "ctx_00000000-0000-4000-8000-000000000003";
    records.records.set(missingId, {
      snapshotId: missingId,
      status: "preparing",
      repositories: [{ serverId: "local", repositoryId: "docs", commit: "f".repeat(40) }],
      expiresAt: "2026-10-21T00:00:00.000Z",
      leases: [],
    });
    const missing = await retainSnapshot({ repository: records, pins }, missingId);
    expect(missing.status).toBe("failed");
    expect(records.records.get(missingId)?.errorCode).toBe("SNAPSHOT_PIN_FAILED");
    expect(records.records.get(missingId)?.repositories[0]?.commit).toBe("f".repeat(40));
  });
});
