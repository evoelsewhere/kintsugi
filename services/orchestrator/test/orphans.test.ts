// Runs left `running` by a dead worker are failed when a worker starts, unless another worker is alive.

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTERRUPTED, failOrphanedQueueJobs, failOrphanedRuns, failStrandedQueueJobs, sweepOrphanedRuns } from "../src/orphans.js";
import { BRAIN_INDEX_QUEUE, DOCUMENT_WRITE_QUEUE, JOB_RUN_QUEUE, QUEUE_SCHEMA, WORKSPACE_CLEANUP_QUEUE, ensureBrainIndexQueue, ensureDocumentWriteQueue, ensureJobRunQueue, ensureWorkspaceCleanupQueue, sendJobRun } from "../src/queues.js";
import { startWorker } from "../src/worker.js";
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

describe.skipIf(!hasDatabase)("queue jobs a stopped worker left active (integration, DC-002)", () => {
  let db: TestDatabase;
  let boss: PgBoss;

  beforeAll(async () => {
    db = await createTestDatabase();
    boss = new PgBoss({ connectionString: db.url, schema: QUEUE_SCHEMA });
    await boss.start();
    await ensureDocumentWriteQueue(boss);
  });
  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await db?.drop();
  });

  const takeWrite = async (repository: string): Promise<string> => {
    await boss.send(DOCUMENT_WRITE_QUEUE, { writeId: randomUUID(), projectId: "demo" }, { singletonKey: repository });
    const [job] = await boss.fetch(DOCUMENT_WRITE_QUEUE);
    return job!.id;
  };

  it("leaves them alone while another worker beats, and hands them back for a retry once none does", async () => {
    const stranded = await takeWrite("docs-a");
    await db.pool.query("insert into workflow.worker_heartbeat (worker_id, host, pid, version, started_at) values ('other', 'another-host', 1, '0', now())");
    expect(await failStrandedQueueJobs(db.pool, boss, [DOCUMENT_WRITE_QUEUE], () => undefined)).toBe(0);
    expect((await boss.getJobById(DOCUMENT_WRITE_QUEUE, stranded))?.state).toBe("active");

    await db.pool.query("update workflow.worker_heartbeat set stopped_at = now() where worker_id = 'other'");
    const logs: string[] = [];
    expect(await failStrandedQueueJobs(db.pool, boss, [DOCUMENT_WRITE_QUEUE], (message) => logs.push(message))).toBe(1);
    // The queue retries a write (retryLimit 2), so another writer takes it at once instead of after its 30-min expiry.
    expect((await boss.getJobById(DOCUMENT_WRITE_QUEUE, stranded))?.state).toBe("retry");
    expect(logs[0]).toContain("document-write");
  });
});

describe.skipIf(!hasDatabase)("a worker that starts over brain-index and cleanup jobs a stopped worker left (integration, P-039)", () => {
  let db: TestDatabase;
  let dataDir: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-stranded-"));
  });
  afterAll(async () => {
    await db?.drop();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  });

  it("hands them back to the queue before it takes any job", async () => {
    // A worker that took one job of each queue and stopped without finishing them.
    const before = new PgBoss({ connectionString: db.url, schema: QUEUE_SCHEMA });
    await before.start();
    await ensureBrainIndexQueue(before);
    await ensureWorkspaceCleanupQueue(before);
    await before.send(BRAIN_INDEX_QUEUE, { projectId: "nobody" }, { singletonKey: "nobody" });
    await before.send(WORKSPACE_CLEANUP_QUEUE, { jobId: randomUUID() });
    const [brain] = await before.fetch(BRAIN_INDEX_QUEUE);
    const [cleanup] = await before.fetch(WORKSPACE_CLEANUP_QUEUE);
    await before.stop({ graceful: false });

    const storage = new CheckoutStorage(dataDir);
    const worker = await startWorker({ databaseUrl: db.url, pool: db.pool, storage, pollIntervalSeconds: 3600, log: () => undefined });
    try {
      const jobs = await db.pool.query<{ id: string; state: string; retry_count: number }>(`select id, state, retry_count from ${QUEUE_SCHEMA}.job where id = any($1)`, [[brain!.id, cleanup!.id]]);
      const byId = new Map(jobs.rows.map((row) => [row.id, row]));
      // The Brain build is retried (retryLimit 1), so the project's index is built again (pg-boss counts the retry when it
      // hands the job out again); a cleanup has no retry.
      const rebuilt = byId.get(brain!.id);
      expect(rebuilt?.state === "retry" || (rebuilt?.retry_count ?? 0) >= 1, JSON.stringify(rebuilt)).toBe(true);
      expect(byId.get(cleanup!.id)?.state).toBe("failed");
    } finally {
      await worker.stop();
    }
  });
});
