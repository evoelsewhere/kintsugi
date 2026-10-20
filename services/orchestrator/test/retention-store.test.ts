import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PostgresSnapshotRetentionRepository } from "../src/git-sync/retention-store.js";
import { pruneExpiredSnapshots } from "../src/git-sync/retention.js";
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
  it("uses database time when the worker clock is ahead", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(workerNow);
    try {
      const { pool, candidateQuery } = retentionPool();
      const repository = new PostgresSnapshotRetentionRepository(pool);
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
    const repository = new PostgresSnapshotRetentionRepository(pool);

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
      const repository = new PostgresSnapshotRetentionRepository(database.pool);
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
