// The Postgres job store and the attempts of a job (ADR-0055): every attempt that ends is added to the run's
// history, and events and spans carry the attempt.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SANDBOX } from "@kintsugi/domain";
import { PgJobStore } from "../src/jobs/store.js";
import { limitsWith, pgSandbox } from "../src/sandbox.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

describe.skipIf(!hasDatabase)("job attempts and reads per repository (integration)", () => {
  let db: TestDatabase;
  let store: PgJobStore;

  beforeAll(async () => {
    db = await createTestDatabase();
    store = new PgJobStore(db.pool);
    await db.pool.query("insert into admin.project (id, name) values ('demo', 'Demo')");
    await db.pool.query("insert into admin.application (project_id, id, name) values ('demo', 'web', 'Web')");
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("adds each attempt that ends to the history of the run, and a retry is the same run with the next attempt", async () => {
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "web", kind: "stage", name: "understand" });
    expect((await store.get(id))?.attempt).toBe(1);
    expect(await store.start(id)).toBe(true);
    await store.fail(id, "the synthesis failed");

    // What the API does for a retry: the same run goes back in the queue as the next attempt.
    await db.pool.query("update workflow.job_run set status = 'queued', attempt = attempt + 1, finished_at = null, failure_reason = null where id = $1", [id]);
    expect(await store.start(id)).toBe(true);
    const running = await store.get(id);
    expect(running).toMatchObject({ status: "running", attempt: 2 });
    await store.succeed(id, { ok: true });

    const row = (await db.pool.query<{ attempts: Array<{ n: number; status: string; reason?: string; startedAt: string; finishedAt: string }> }>("select attempts from workflow.job_run where id = $1", [id])).rows[0]!;
    expect(row.attempts.map((attempt) => [attempt.n, attempt.status, attempt.reason ?? null])).toEqual([
      [1, "failed", "the synthesis failed"],
      [2, "succeeded", null],
    ]);
    expect(row.attempts.every((attempt) => typeof attempt.startedAt === "string" && typeof attempt.finishedAt === "string")).toBe(true);
  });

  it("keeps the history of a run only for the top-level run, not for its steps", async () => {
    const parent = randomUUID();
    const child = randomUUID();
    await store.create({ id: parent, projectId: "demo", applicationId: "web", kind: "stage", name: "assess" });
    await store.create({ id: child, projectId: "demo", applicationId: "web", parentId: parent, kind: "script", name: "inventory.py" });
    await store.start(child);
    await store.succeed(child, {});
    const row = (await db.pool.query<{ attempts: unknown[] }>("select attempts from workflow.job_run where id = $1", [child])).rows[0]!;
    expect(row.attempts).toEqual([]);
  });

  it("records the attempt of an event, one by default", async () => {
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "web", kind: "stage", name: "assess" });
    await store.addEvent({ runId: id, attempt: 2, kind: "log", message: "resuming" });
    await store.addEvent({ runId: id, kind: "log", message: "first attempt by default" });
    const attempts = await db.pool.query<{ attempt: number }>("select attempt from workflow.job_event where job_run_id = $1 order by id", [id]);
    expect(attempts.rows.map((row) => row.attempt)).toEqual([2, 1]);
  });

  it("reads the sandbox settings from the database field by field, and keeps the last ones when it cannot be read", async () => {
    const provider = pgSandbox(db.pool, 0);
    expect(await provider()).toEqual(DEFAULT_SANDBOX);
    await db.pool.query("insert into admin.installation_setting (key, value, updated_by) values ('sandbox', $1, 'admin')", [JSON.stringify({ retentionDays: 14, checkoutHours: 99999, markReadOnly: false, maxTurns: 40 })]);
    const stored = { ...DEFAULT_SANDBOX, retentionDays: 14, markReadOnly: false, maxTurns: 40 };
    expect(await provider()).toEqual(stored);

    let down = false;
    const flaky = pgSandbox({ query: ((...args: unknown[]) => (down ? Promise.reject(new Error("down")) : (db.pool.query as (...a: unknown[]) => Promise<unknown>)(...args))) as never }, 0);
    expect(await flaky()).toEqual(stored);
    down = true;
    expect(await flaky()).toEqual(stored);
    expect(await pgSandbox({ query: () => Promise.reject(new Error("down")) } as never, 0)()).toEqual(DEFAULT_SANDBOX);
  });

  it("turns the settings into the limits of a job: 0 means no limit", () => {
    const base = { script: { timeoutSec: 1, maxOutputBytes: 1 }, agent: { timeoutSec: 1, maxOutputBytes: 1 }, workflow: { maxAgents: 7, concurrency: 2, maxTokens: 0 }, stage: { maxAgents: 9, concurrency: 3 } };
    expect(limitsWith(base, DEFAULT_SANDBOX)).toEqual({ ...base, script: { timeoutSec: 600, maxOutputBytes: 52428800 }, agent: { timeoutSec: 0, maxOutputBytes: 52428800 } });
    expect(limitsWith(base, { ...DEFAULT_SANDBOX, agentTimeoutSec: 900, maxTurns: 25, maxCostUsd: 1.5, scriptTimeoutSec: 60 })).toEqual({
      ...base,
      script: { timeoutSec: 60, maxOutputBytes: 52428800 },
      agent: { timeoutSec: 900, maxOutputBytes: 52428800, maxTurns: 25, maxCostUsd: 1.5 },
    });
  });
});
