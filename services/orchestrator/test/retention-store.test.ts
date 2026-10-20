import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror, resolveCommit } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import pg, { type Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresSnapshotRetentionRepository } from "../src/git-sync/retention-store.js";
import { GitSnapshotPins, pruneExpiredSnapshots, retainSnapshot, snapshotPinRef } from "../src/git-sync/retention.js";
import { withMirrorLock } from "../src/git-sync/sync.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

const snapshotId = "ctx_00000000-0000-4000-8000-000000000009";
const snapshotExpiry = new Date("2026-10-21T00:00:00.000Z");
const databaseNow = new Date("2026-10-20T00:00:00.000Z");
const workerNow = new Date("2026-10-22T00:00:00.000Z");

function retentionPool() {
  let status = "ready";
  const candidateQuery = vi.fn(async (sql: string, ..._values: unknown[]) => {
    const comparisonTime = sql.includes("clock_timestamp()") ? databaseNow : workerNow;
    const rows = snapshotExpiry <= comparisonTime
      ? [{ snapshot_id: snapshotId, status: "ready", expires_at: snapshotExpiry, failure_code: null }]
      : [];
    return { rows, rowCount: rows.length };
  });
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      const normalized = sql.trim().toLowerCase();
      if (normalized === "begin" || normalized === "commit" || normalized === "rollback") return { rows: [], rowCount: 0 };
      if (normalized.startsWith("select snapshot_id, status, expires_at, failure_code")) {
        return values === undefined ? candidateQuery(sql) : candidateQuery(sql, values);
      }
      if (normalized.startsWith("select exists")) return { rows: [{ present: false }], rowCount: 1 };
      if (normalized.startsWith("update delivery.member_snapshot set status = 'expiring'")) {
        status = "expiring";
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string) => {
      const normalized = sql.trim().toLowerCase();
      if (normalized.startsWith("select snapshot_id, requested_by_user_id")) {
        return { rows: [{ snapshot_id: snapshotId, status, expires_at: snapshotExpiry, failure_code: null }] };
      }
      if (normalized.startsWith("select distinct repository_id")) return { rows: [] };
      if (normalized.startsWith("select expires_at from delivery.member_snapshot_lease")) return { rows: [] };
      return { rows: [] };
    }),
  } as unknown as Pool;
  return { pool, client, candidateQuery };
}

describe("Postgres snapshot retention clock", () => {
  it("marks a preparing snapshot ready only while database expiry is in the future", async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [], rowCount: 1 }));
    const pool = { query } as unknown as Pool;
    const repository = new PostgresSnapshotRetentionRepository(pool, pool);

    expect(await repository.markReady(snapshotId)).toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain("expires_at > clock_timestamp()");
    expect(query.mock.calls[0]?.[0]).toContain("ready_at = clock_timestamp()");

    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await repository.markReady(snapshotId)).toBe(false);
  });

  it("uses database time when the worker clock is ahead", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(workerNow);
    try {
      const { pool, candidateQuery } = retentionPool();
      const repository = new PostgresSnapshotRetentionRepository(pool, pool);
      const result = await repository.claimExpired();

      expect(result.snapshots).toEqual([]);
      expect(result.retained).toBe(0);
      expect(candidateQuery.mock.calls[0]?.[0]).toContain("expires_at <= clock_timestamp()");
      expect(candidateQuery.mock.calls[0]?.[1]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses database time for the final expiry guard", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.trim().toLowerCase() === "begin" || sql.trim().toLowerCase() === "commit") return { rows: [], rowCount: 0 };
      if (sql.includes("update delivery.member_snapshot set status = 'expired'")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
      query: vi.fn(),
    } as unknown as Pool;
    const repository = new PostgresSnapshotRetentionRepository(pool, pool);

    await repository.markExpired(snapshotId);

    const update = query.mock.calls.find(([sql]) => sql.includes("status = 'expired'"))?.[0];
    expect(update).toContain("expires_at <= clock_timestamp()");
    expect(update).toContain("expired_at = clock_timestamp()");
  });
});

describe.skipIf(!hasDatabase)("Postgres snapshot retention clock skew (integration)", () => {
  let database: TestDatabase;
  const integrationSnapshotId = "ctx_00000000-0000-4000-8000-000000000010";

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.pool.query("insert into admin.project (id, name) values ('retention-clock-test', 'Retention Clock Test')");
    await database.pool.query(
      "insert into delivery.member_snapshot " +
        "(snapshot_id, project_id, unit_id, activity, requested_by_user_id, context_revision, task, readiness, manifest, status, pin_state, expires_at, ready_at) " +
        "values ($1, 'retention-clock-test', 'app/module/unit', 'implementation', 'member-test', $2, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'ready', 'retained', clock_timestamp() + interval '5 minutes', clock_timestamp())",
      [integrationSnapshotId, "sha256:" + "a".repeat(64)],
    );
  });

  afterAll(async () => {
    await database?.drop();
  });

  it("does not expire a DB-future snapshot when the worker clock is one day ahead", async () => {
    const workerNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(workerNow);
    try {
      const repository = new PostgresSnapshotRetentionRepository(database.pool, database.pool);
      const result = await pruneExpiredSnapshots({
        repository,
        pins: { retain: async () => false, release: async () => undefined },
      });
      const status = await database.pool.query<{ status: string }>(
        "select status from delivery.member_snapshot where snapshot_id = $1",
        [integrationSnapshotId],
      );

      expect(result).toEqual({ released: 0, retained: 0 });
      expect(status.rows[0]?.status).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe.skipIf(!hasDatabase)("Postgres snapshot retention progress (integration)", () => {
  let database: TestDatabase;
  let remote: GitHttpServer;
  let dataDir: string;
  let storage: CheckoutStorage;
  let commit: string;
  const projectId = "retention-progress-test";
  const serverId = "retention-progress-server";
  const repositoryId = "retention-progress-docs";
  let progressSnapshotId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-retention-progress-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    commit = await remote.commit("docs", "README.md", "retained snapshot\n");
    await cloneMirror(remote.baseUrl + "/docs.git", storage.mirror(serverId, repositoryId), { allowHttp: true });
    await database.pool.query("insert into admin.project (id, name) values ($1, 'Retention Progress Test')", [projectId]);
    await database.pool.query(
      "insert into admin.git_server (id, kind, name, base_url, auth_type) values ($1, 'plain-git', 'Retention Test', $2, 'none')",
      [serverId, remote.baseUrl],
    );
    await database.pool.query(
      "insert into admin.git_repository (id, server_id, url) values ($1, $2, $3)",
      [repositoryId, serverId, remote.baseUrl + "/docs.git"],
    );
  });

  beforeEach(async () => {
    progressSnapshotId = "ctx_" + randomUUID();
    await database.pool.query("delete from delivery.member_snapshot where project_id = $1", [projectId]);
  });

  afterAll(async () => {
    await remote?.close();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
    await database?.drop();
  });

  async function prepareSnapshot(expired = false, sourceCommit = commit): Promise<void> {
    await database.pool.query(
      "insert into delivery.member_snapshot " +
        "(snapshot_id, project_id, unit_id, activity, requested_by_user_id, context_revision, task, readiness, manifest, created_at, expires_at) " +
        "values ($1, $2, 'app/module/unit', 'implementation', 'member-test', $3, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, " +
        "clock_timestamp() - interval '10 minutes', clock_timestamp() + $4::interval)",
      [progressSnapshotId, projectId, "sha256:" + "a".repeat(64), expired ? "-1 minute" : "5 minutes"],
    );
    await database.pool.query(
      "insert into delivery.member_snapshot_source " +
        "(snapshot_id, source_id, role, repository_id, source_commit, source_path, content_hash, availability, publication, approval, required_for, is_required, readable, sections) " +
        "values ($1, 'readme', 'standards', $2, $3, 'README.md', $4, 'present', 'published', 'approved', '[]'::jsonb, true, true, '[]'::jsonb)",
      [progressSnapshotId, repositoryId, sourceCommit, "sha256:" + "b".repeat(64)],
    );
  }

  function singleConnectionDependencies(lockPool: Pool) {
    return {
      repository: new PostgresSnapshotRetentionRepository(database.pool, lockPool),
      pins: new GitSnapshotPins(storage),
    };
  }

  it("retains a snapshot with one pool connection, including Git coordinates and ready transition", async () => {
    await prepareSnapshot();
    // A nested checkout fails promptly, so a regression cannot leave pool.end() waiting forever.
    const pool = new pg.Pool({ connectionString: database.url, max: 1, connectionTimeoutMillis: 500 });
    try {
      const deps = singleConnectionDependencies(pool);
      await expect(retainSnapshot(deps, progressSnapshotId)).resolves.toEqual({ status: "ready", pinned: 1 });
      expect((await deps.repository.get(progressSnapshotId))?.status).toBe("ready");
      expect(await resolveCommit(storage.mirror(serverId, repositoryId), snapshotPinRef(progressSnapshotId, repositoryId))).toBe(commit);
    } finally {
      await pool.end();
    }
  });

  it("fails unavailable snapshot objects with one pool connection", async () => {
    await prepareSnapshot(false, "f".repeat(40));
    const pool = new pg.Pool({ connectionString: database.url, max: 1, connectionTimeoutMillis: 500 });
    try {
      const deps = singleConnectionDependencies(pool);
      await expect(retainSnapshot(deps, progressSnapshotId)).resolves.toEqual({ status: "failed", pinned: 0, errorCode: "SNAPSHOT_PIN_FAILED" });
      expect((await deps.repository.get(progressSnapshotId))?.status).toBe("failed");
    } finally {
      await pool.end();
    }
  });

  it("releases expired preparation pins with one pool connection", async () => {
    await prepareSnapshot(true);
    const pool = new pg.Pool({ connectionString: database.url, max: 1, connectionTimeoutMillis: 500 });
    try {
      const deps = singleConnectionDependencies(pool);
      await expect(retainSnapshot(deps, progressSnapshotId)).resolves.toEqual({ status: "failed", pinned: 0, errorCode: "SNAPSHOT_PREPARATION_EXPIRED" });
      expect((await deps.repository.get(progressSnapshotId))?.status).toBe("failed");
      await expect(resolveCommit(storage.mirror(serverId, repositoryId), snapshotPinRef(progressSnapshotId, repositoryId))).rejects.toThrow();
    } finally {
      await pool.end();
    }
  });

  it("allows the mirror lock owner to query a one-connection main pool while retention waits", async () => {
    await prepareSnapshot();
    const mainPool = new pg.Pool({ connectionString: database.url, max: 1, connectionTimeoutMillis: 500 });
    const lockPool = new pg.Pool({ connectionString: database.url, max: 1, connectionTimeoutMillis: 500 });
    let mirrorEntered!: () => void;
    const mirrorReady = new Promise<void>((resolve) => { mirrorEntered = resolve; });
    let runOwnerQuery!: () => void;
    const ownerMayQuery = new Promise<void>((resolve) => { runOwnerQuery = resolve; });
    let pinEntered!: () => void;
    const pinWaiting = new Promise<void>((resolve) => { pinEntered = resolve; });
    const mirrorOwner = withMirrorLock(repositoryId, async () => {
      mirrorEntered();
      await ownerMayQuery;
      return mainPool.query<{ progress: number }>("select 1 as progress");
    });
    let retention: ReturnType<typeof retainSnapshot> | undefined;
    try {
      await mirrorReady;
      const pins = new GitSnapshotPins(storage);
      retention = retainSnapshot({
        repository: new PostgresSnapshotRetentionRepository(mainPool, lockPool),
        pins: {
          retain: (snapshotId, pin) => {
            pinEntered();
            return pins.retain(snapshotId, pin);
          },
          release: (snapshotId, pin) => pins.release(snapshotId, pin),
        },
      }, progressSnapshotId);
      await pinWaiting;
      runOwnerQuery();

      await expect(mirrorOwner).resolves.toMatchObject({ rows: [{ progress: 1 }] });
      await expect(retention).resolves.toEqual({ status: "ready", pinned: 1 });
    } finally {
      runOwnerQuery();
      await Promise.allSettled([mirrorOwner, ...(retention === undefined ? [] : [retention])]);
      await Promise.all([mainPool.end(), lockPool.end()]);
    }
  });

  it("expires an unleased snapshot after 100 older snapshots with indefinite leases", async () => {
    const ids = Array.from({ length: 101 }, (_, index) =>
      "ctx_00000000-0000-4000-8000-" + String(index + 1000).padStart(12, "0"));
    const unleasedId = ids[100]!;
    await database.pool.query(
      "insert into delivery.member_snapshot " +
        "(snapshot_id, project_id, unit_id, activity, requested_by_user_id, context_revision, task, readiness, manifest, status, pin_state, created_at, expires_at, ready_at) " +
        "select snapshot_id, $2, 'app/module/unit', 'implementation', 'member-test', $3, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'ready', 'retained', " +
        "clock_timestamp() - interval '3 days', clock_timestamp() - interval '2 days' + ordinal * interval '1 second', clock_timestamp() - interval '3 days' " +
        "from unnest($1::text[]) with ordinality as snapshots(snapshot_id, ordinal)",
      [ids, projectId, "sha256:" + "a".repeat(64)],
    );
    await database.pool.query(
      "insert into delivery.member_snapshot_lease (lease_id, snapshot_id, purpose, owner_id) " +
        "select gen_random_uuid(), snapshot_id, 'review', 'member-test' from unnest($1::text[]) as snapshots(snapshot_id)",
      [ids.slice(0, 100)],
    );

    const repository = new PostgresSnapshotRetentionRepository(database.pool, database.pool);
    const result = await pruneExpiredSnapshots({ repository, pins: { retain: async () => false, release: async () => undefined } });

    expect(result).toEqual({ released: 1, retained: 100 });
    expect((await repository.get(unleasedId))?.status).toBe("expired");
    const retained = await database.pool.query<{ count: string }>(
      "select count(*) from delivery.member_snapshot where project_id = $1 and status = 'ready'", [projectId],
    );
    expect(retained.rows[0]?.count).toBe("100");
  });
});
