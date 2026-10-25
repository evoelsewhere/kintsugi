// Real Postgres admission races: these tests use a disposable database, never the installation database.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, ensureSchema } from "#common/db/pool.js";
import { PgJobRunStore } from "../../src/modules/delivery/runtime-jobs/infrastructure/pg-job-run.store.js";
import { RunScopeConflict } from "../../src/modules/delivery/runtime-jobs/domain/run-scope-conflict.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "../support/database.js";

const store = new PgJobRunStore();
describe.skipIf(!hasDatabase)("atomic unit scope admission", () => {
  let db: TestDatabase;
  const originalUrl = process.env["DATABASE_URL"];
  beforeAll(async () => {
    db = await createTestDatabase();
    process.env["DATABASE_URL"] = db.url;
    await ensureSchema();
    await db.query("insert into admin.project (id, name) values ('scope', 'Scope')");
    for (const id of ["same", "disjoint", "sets", "retry", "history", "double-retry", "direct"]) {
      await db.query("insert into admin.application (project_id, id, name) values ('scope', $1, $1)", [id]);
    }
  });
  afterAll(async () => {
    await closePool();
    await db?.drop();
    if (originalUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = originalUrl;
  });
  const start = (applicationId: string, items: string[], stage = "understand", set?: string) => store.createStageRun({
    id: randomUUID(), projectId: "scope", applicationId, stage, sources: [{ repositoryId: "legacy", role: "legacy" }],
    inputs: { scope: { items, ...(set === undefined ? {} : { set }) } },
  });

  it("admits only one of two simultaneous starts on overlapping units", async () => {
    const results = await Promise.allSettled([start("same", ["card/a", "card/b"]), start("same", ["card/b", "card/c"])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason).toBeInstanceOf(RunScopeConflict);
  });

  it("allows disjoint scopes and distinct design sets", async () => {
    await Promise.all([start("disjoint", ["card/a"]), start("disjoint", ["card/b"])]);
    await Promise.all([start("sets", ["card/a"], "design", "api"), start("sets", ["card/a"], "design", "test")]);
    await expect(start("sets", ["card/a"], "design", "api")).rejects.toBeInstanceOf(RunScopeConflict);
  });

  it("serializes starts and retries, without incrementing a rejected retry", async () => {
    const old = await start("retry", ["card/a"]);
    await db.query("update workflow.job_run set status = 'failed' where id = $1", [old.id]);
    const results = await Promise.allSettled([store.requeue("scope", old.id, { fresh: false }), start("retry", ["card/a"])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(RunScopeConflict);
    const current = await store.summary("scope", old.id);
    expect(current?.attempt).toBe(current?.status === "queued" ? 2 : 1);
  });

  it("retains an open or closed PR claim until abandoned, and rejects retries after a newer merge", async () => {
    const old = await start("history", ["card/a"]);
    await db.query("update workflow.job_run set status = 'failed' where id = $1", [old.id]);
    const newer = await start("history", ["card/a"]);
    await db.query("insert into workflow.document_write (id, project_id, kind, message, status, branch) values ('scope-write', 'scope', 'job-output', 'Understand', 'pr-opened', 'kintsugi/scope')");
    await db.query("update workflow.job_run set status = 'succeeded', document_write_id = 'scope-write' where id = $1", [newer.id]);
    await expect(start("history", ["card/a"])).rejects.toBeInstanceOf(RunScopeConflict);
    await expect(store.requeue("scope", old.id, { fresh: false })).rejects.toBeInstanceOf(RunScopeConflict);
    await db.query("update workflow.document_write set status = 'closed' where id = 'scope-write'");
    await expect(start("history", ["card/a"])).rejects.toBeInstanceOf(RunScopeConflict);
    await store.abandon("scope", newer.id, "reviewer");
    const after = await start("history", ["card/a"]);
    await db.query("update workflow.job_run set status = 'cancelled' where id = $1", [after.id]);
    await db.query("update workflow.document_write set status = 'merged', updated_at = clock_timestamp() where id = 'scope-write'");
    await expect(store.requeue("scope", old.id, { fresh: true })).rejects.toThrow(/pinned documents/);
    expect((await store.summary("scope", old.id))?.attempt).toBe(1);
    await expect(start("history", ["card/a"])).resolves.toMatchObject({ status: "queued" });
  });

  it("releases directly committed output but refuses retries pinned before it", async () => {
    const old = await start("direct", ["card/a"]);
    await db.query("update workflow.job_run set status = 'failed' where id = $1", [old.id]);
    const newer = await start("direct", ["card/a"]);
    await db.query("insert into workflow.document_write (id, project_id, kind, message, status) values ('direct-write', 'scope', 'job-output', 'Understand', 'committed')");
    await db.query("update workflow.job_run set status = 'succeeded', document_write_id = 'direct-write' where id = $1", [newer.id]);
    await expect(store.requeue("scope", old.id, { fresh: false })).rejects.toThrow(/pinned documents/);
    await expect(start("direct", ["card/a"])).resolves.toMatchObject({ status: "queued" });
  });

  it("increments a failed run once under simultaneous retries", async () => {
    const old = await start("double-retry", ["card/a"]);
    await db.query("update workflow.job_run set status = 'failed' where id = $1", [old.id]);
    const results = await Promise.all([store.requeue("scope", old.id, { fresh: false }), store.requeue("scope", old.id, { fresh: false })]);
    expect(results.sort()).toEqual([false, true]);
    expect((await store.summary("scope", old.id))?.attempt).toBe(2);
  });
});
