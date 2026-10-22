// Real PostgreSQL transactions, with test-only query barriers at the replacement boundary.
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { closePool, ensureSchema, getPool } from "../../src/common/db/pool.js";
import { PgTaskProjectionRepository } from "../../src/modules/delivery/agent-context/infrastructure/pg-task-projection.repository.js";
import type { ProjectTaskSnapshot } from "../../src/modules/delivery/agent-context/domain/task.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "../support/database.js";

const fingerprint = createHash("sha256").update(JSON.stringify(["web"])).digest("hex");
function snapshot(commit: string, unit: string): ProjectTaskSnapshot {
  const unitId = "web/core/" + unit;
  return { projectId: "shop", repositoryId: "docs", commit: commit.repeat(40), applicationIdsFingerprint: fingerprint,
    tasks: [{ projectId: "shop", unitId, repositoryId: "docs", sourceCommit: commit.repeat(40),
      sourcePath: "10-applications/web/02-modern/core/" + unit + "/README.md", sourceHash: "b".repeat(64),
      workItem: { id: unitId, application: "web", module: "core", kind: "module", title: unit,
        phase: "migrate", status: "pending" }, requiredInputs: [], sourceReferences: [], predecessorGates: [] }], issues: [] };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe.skipIf(!hasDatabase)("atomic task projection replacement (PostgreSQL)", () => {
  let db: TestDatabase;
  const repository = new PgTaskProjectionRepository();
  beforeAll(async () => {
    db = await createTestDatabase();
    process.env["DATABASE_URL"] = db.url;
    await ensureSchema();
    await db.query("insert into admin.project (id, name) values ('shop', 'Shop')");
    await db.query("insert into admin.application (project_id, id, name) values ('shop', 'web', 'Web')");
    await db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://localhost', 'none')");
    await db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://localhost/docs.git', 'main')");
  });
  afterAll(async () => { await closePool(); await db?.drop(); });

  async function overlap(first: ProjectTaskSnapshot, second: ProjectTaskSnapshot) {
    const expected = await repository.indexRevision("shop");
    const firstDeleted = deferred();
    const releaseFirst = deferred();
    const secondDeleted = deferred();
    let sequence = 0;
    let stopObserving = false;
    let secondPid: number | undefined;
    const pool = getPool();
    const connect = pool.connect.bind(pool);
    const spy = vi.spyOn(pool, "connect").mockImplementation((async () => {
      const client = await connect();
      const ordinal = ++sequence;
      if (ordinal === 2) secondPid = (client as PoolClient & { processID: number }).processID;
      const query = client.query.bind(client);
      const release = client.release.bind(client);
      client.query = (async (sql: string, values?: unknown[]) => {
        const result = await query(sql, values);
        if (sql.startsWith("delete from delivery.member_task_projection")) {
          if (ordinal === 1) { firstDeleted.resolve(); await releaseFirst.promise; }
          if (ordinal === 2) secondDeleted.resolve();
        }
        return result;
      }) as typeof client.query;
      client.release = (...args) => { client.query = query; client.release = release; release(...args); };
      return client;
    }) as typeof pool.connect);
    try {
      const firstWrite = repository.replaceProject(first, expected);
      await firstDeleted.promise;
      const secondWrite = repository.replaceProject(second, expected);
      // Wait for a real database lock, or both DELETE statements completing on an empty index.
      // No elapsed delay determines the winning transaction.
      await Promise.race([secondDeleted.promise, (async () => {
        for (let attempt = 0; attempt < 500 && !stopObserving; attempt += 1) {
          if (secondPid !== undefined) {
            const status = await db.query<{ waiting: boolean }>(
              "select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1", [secondPid]);
            if (status.rows[0]?.waiting === true) return;
          }
          await delay(10);
        }
        if (!stopObserving) throw new Error("second replacement did not reach the transaction barrier");
      })()]);
      stopObserving = true;
      releaseFirst.resolve();
      return await Promise.allSettled([firstWrite, secondWrite]);
    } finally { stopObserving = true; releaseFirst.resolve(); spy.mockRestore(); }
  }

  it("serializes overlapping initial refreshes instead of raising duplicate-key 23505", async () => {
    const results = await overlap(snapshot("a", "same"), snapshot("a", "same"));
    expect(results).toEqual([{ status: "fulfilled", value: true }, { status: "fulfilled", value: false }]);
    expect((await repository.list("shop")).map(({ unitId }) => unitId)).toEqual(["web/core/same"]);
  });

  it("never leaves the union of disjoint snapshots after overlapping replacements", async () => {
    const results = await overlap(snapshot("b", "first"), snapshot("c", "second"));
    expect(results).toEqual([{ status: "fulfilled", value: true }, { status: "fulfilled", value: false }]);
    expect((await repository.list("shop")).map(({ unitId }) => unitId)).toEqual(["web/core/first"]);
  });

  it("invalidates a same-commit index when an application is deleted and recreated", async () => {
    expect(await repository.indexRevision("shop")).toBeDefined();
    await db.query("delete from admin.application where project_id = 'shop' and id = 'web'");
    await db.query("insert into admin.application (project_id, id, name) values ('shop', 'web', 'Web')");
    expect(await repository.indexRevision("shop")).toBeUndefined();
  });

  it("retries a refresh when its application is concurrently deleted instead of failing a foreign key", async () => {
    expect(await repository.replaceProject(snapshot("d", "deleted"), undefined)).toBe(true);
    const expected = await repository.indexRevision("shop");
    const deletion = new pg.Client({ connectionString: db.url });
    await deletion.connect();
    let replacement: Promise<unknown> | undefined;
    try {
      await deletion.query("begin");
      await deletion.query("delete from admin.application where project_id = 'shop' and id = 'web'");
      replacement = repository.replaceProject(snapshot("e", "after-delete"), expected).then(
        (value) => ({ value }), (error: unknown) => ({ error }),
      );
      let waiting = false;
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const state = await db.query<{ waiting: boolean }>(
          "select exists(select 1 from pg_stat_activity where datname = current_database() " +
          "and pid <> pg_backend_pid() and wait_event_type = 'Lock') as waiting",
        );
        if (state.rows[0]?.waiting) { waiting = true; break; }
        await delay(10);
      }
      expect(waiting).toBe(true);
      await deletion.query("commit");
      expect(await replacement).toEqual({ value: false });
    } finally {
      await deletion.query("rollback");
      await deletion.end();
      if (replacement !== undefined) await replacement;
    }
  });
});
