// The worker's database-only helpers on a throwaway database: gates a stage plan requests and
// polls (idempotent while pending, audited, decided by a person) and the worker heartbeat
// (upserted per beat, marked stopped on shutdown, old rows forgotten).

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WORKER_ACTOR, gateState, requestGate, waitForGate } from "../src/gates.js";
import { startHeartbeat } from "../src/heartbeat.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

describe.skipIf(!hasDatabase)("gates and heartbeat (integration)", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.pool.query("insert into admin.project (id, name) values ('alpha', 'Alpha')");
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("requests a gate once while it is pending and audits the request", async () => {
    const request = { id: randomUUID(), projectId: "alpha", applicationId: "web", gateKey: "stage:assess", title: "Review the assessment", subject: "run-1" };
    const first = await requestGate(db.pool, request);
    expect(first).toMatchObject({ id: request.id, status: "pending", created: true });

    const again = await requestGate(db.pool, { ...request, id: randomUUID() });
    expect(again).toMatchObject({ id: request.id, status: "pending", created: false });

    // Another subject is another gate.
    const other = await requestGate(db.pool, { ...request, id: randomUUID(), subject: "run-2" });
    expect(other.created).toBe(true);

    const audit = await db.pool.query<{ actor: string; action: string; project_id: string; detail: Record<string, unknown> }>(
      "select actor, action, project_id, detail from governance.audit_event where subject = $1",
      [request.id],
    );
    expect(audit.rows).toEqual([{ actor: WORKER_ACTOR, action: "gate.request", project_id: "alpha", detail: { gateKey: "stage:assess", applicationId: "web", about: "run-1" } }]);
  });

  it("waits for the decision and opens a fresh gate after it", async () => {
    const request = { id: randomUUID(), projectId: "alpha", gateKey: "G1", title: "Portfolio decision" };
    await requestGate(db.pool, request);
    const waiting = waitForGate(db.pool, request.id, { intervalMs: 50 });
    await db.pool.query("update governance.gate set status = 'rejected', decided_by = 'reviewer', decided_at = now(), note = 'Missing scorecard' where id = $1", [request.id]);
    await expect(waiting).resolves.toMatchObject({ id: request.id, status: "rejected", decidedBy: "reviewer", note: "Missing scorecard" });

    const retry = await requestGate(db.pool, { ...request, id: randomUUID() });
    expect(retry.created).toBe(true);
    expect(retry.id).not.toBe(request.id);
    expect(await gateState(db.pool, "unknown")).toBeUndefined();
  });

  it("stops waiting when aborted", async () => {
    const request = { id: randomUUID(), projectId: "alpha", gateKey: "G2", title: "Architecture review" };
    await requestGate(db.pool, request);
    const abort = new AbortController();
    const waiting = waitForGate(db.pool, request.id, { intervalMs: 50, signal: abort.signal });
    abort.abort(new Error("worker stopping"));
    await expect(waiting).rejects.toThrow("worker stopping");
  });

  it("beats, reports active jobs and marks itself stopped", async () => {
    await db.pool.query(
      "insert into workflow.worker_heartbeat (worker_id, host, pid, version, started_at, last_seen_at) values ('ancient', 'old-host', 1, '0.0.0', now() - interval '30 days', now() - interval '30 days')",
    );
    let jobs = 2;
    const heartbeat = await startHeartbeat({ pool: db.pool, queues: ["git-sync", "job-run"], activeJobs: () => jobs, intervalSeconds: 3600, version: "1.2.3", log: () => undefined });
    const row = async () =>
      (
        await db.pool.query<{ version: string; pid: number; active_jobs: number; queues: string[]; stopped_at: Date | null }>(
          "select version, pid, active_jobs, queues, stopped_at from workflow.worker_heartbeat where worker_id = $1",
          [heartbeat.workerId],
        )
      ).rows[0];
    expect(await row()).toMatchObject({ version: "1.2.3", pid: process.pid, active_jobs: 2, queues: ["git-sync", "job-run"], stopped_at: null });
    expect((await db.pool.query("select 1 from workflow.worker_heartbeat where worker_id = 'ancient'")).rowCount).toBe(0);

    jobs = 0;
    await heartbeat.beat();
    expect((await row())?.active_jobs).toBe(0);

    await heartbeat.stop();
    expect((await row())?.stopped_at).toBeInstanceOf(Date);
  });
});
