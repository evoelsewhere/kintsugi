// Runs left `running` by a dead worker are failed when a worker starts, unless another worker is alive.

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTERRUPTED, failOrphanedQueueJobs, failOrphanedRuns, sweepOrphanedRuns } from "../src/orphans.js";
import { JOB_RUN_QUEUE, QUEUE_SCHEMA, ensureJobRunQueue, sendJobRun } from "../src/queues.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

function fakePool(alive: boolean, updated: number) {
  const row = { host: alive ? "another-host" : hostname(), pid: 999_999_999 };
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    pool: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return sql.startsWith("select") ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: updated };
      },
    } as never,
  };
}

describe("orphaned runs", () => {
  it("fails the running runs when no other worker is alive", async () => {
    const { pool, queries } = fakePool(false, 2);
    const logs: string[] = [];
    expect(await failOrphanedRuns(pool, (message) => logs.push(message))).toBe(2);
    expect(queries[1]?.sql).toContain("set status = 'failed'");
    expect(queries[1]?.params).toEqual([INTERRUPTED]);
    expect(logs).toHaveLength(1);
  });

  it("leaves them alone while another worker beats", async () => {
    const { pool, queries } = fakePool(true, 2);
    expect(await failOrphanedRuns(pool, () => undefined)).toBe(0);
    expect(queries).toHaveLength(1);
  });
});

describe("orphaned runs after a recreate (T3-009)", () => {
  /** A pool whose heartbeat query says another worker is alive for the first `aliveFor` sweeps. */
  function sequencedPool(aliveFor: number) {
    let sweeps = 0;
    const updates: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith("select now()")) return { rows: [{ at: "2026-11-01T03:00:00Z" }], rowCount: 1 };
        if (sql.startsWith("select")) {
          sweeps += 1;
          return { rows: [{ host: sweeps <= aliveFor ? "another-host" : hostname(), pid: 999_999_999 }], rowCount: 1 };
        }
        updates.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    } as never;
    return { pool, updates };
  }
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it("sweeps once more after a fresh heartbeat has gone stale, failing only runs started before this worker", async () => {
    const { pool, updates } = sequencedPool(1);
    await sweepOrphanedRuns(pool, () => undefined, 50);
    expect(updates).toHaveLength(0);
    await wait(150);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.sql).toContain("started_at < $2");
    expect(updates[0]?.params).toEqual([INTERRUPTED, "2026-11-01T03:00:00Z"]);
  });

  it("sweeps at once when no other worker is alive, and leaves the runs alone while another one keeps beating", async () => {
    const now = sequencedPool(0);
    await sweepOrphanedRuns(now.pool, () => undefined, 50);
    expect(now.updates).toHaveLength(1);
    expect(now.updates[0]?.sql).not.toContain("started_at <");
    const beating = sequencedPool(5);
    await sweepOrphanedRuns(beating.pool, () => undefined, 50);
    await wait(150);
    expect(beating.updates).toHaveLength(0);
  });

  it("cancels the second sweep when the worker stops", async () => {
    const { pool, updates } = sequencedPool(1);
    const cancel = await sweepOrphanedRuns(pool, () => undefined, 50);
    cancel();
    await wait(150);
    expect(updates).toHaveLength(0);
  });
});

describe.skipIf(!hasDatabase)("queue jobs of runs a stopped worker left (integration, T2-022)", () => {
  let db: TestDatabase;
  let boss: PgBoss;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.pool.query("insert into admin.project (id, name) values ('demo', 'Demo')");
    boss = new PgBoss({ connectionString: db.url, schema: QUEUE_SCHEMA });
    await boss.start();
    await ensureJobRunQueue(boss);
  });
  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await db?.drop();
  });

  it("fails an active queue job whose run is no longer running, and leaves a live run's job active", async () => {
    const [stopped, live] = [randomUUID(), randomUUID()];
    await db.pool.query(
      "insert into workflow.job_run (id, project_id, kind, name, status) values ($1, 'demo', 'stage', 'assess', 'failed'), ($2, 'demo', 'stage', 'assess', 'running')",
      [stopped, live],
    );
    for (const id of [stopped, live]) await sendJobRun(boss, { jobRunId: id });
    // What a worker does when it takes them: both are active now.
    const taken = await boss.fetch<{ jobRunId: string }>(JOB_RUN_QUEUE, { batchSize: 2 });
    expect(taken).toHaveLength(2);
    const logs: string[] = [];
    expect(await failOrphanedQueueJobs(db.pool, boss, (message) => logs.push(message))).toBe(1);
    const state = async (runId: string): Promise<string | undefined> => {
      const job = taken.find((entry) => entry.data.jobRunId === runId)!;
      return (await boss.getJobById(JOB_RUN_QUEUE, job.id))?.state;
    };
    expect(await state(stopped)).toBe("failed");
    expect(await state(live)).toBe("active");
    expect(logs).toHaveLength(1);
  });
});
