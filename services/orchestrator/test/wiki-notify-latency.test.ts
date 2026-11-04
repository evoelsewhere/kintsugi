// The latency of a change notification (P3-008 AC4, exit step 2 of Phase 3): from the moment the review watch records that a
// page's pull request was merged to the moment the watcher's notification exists, with the real worker (sync, review watch,
// Brain build, notify job) and a real git remote. The merge is done by a person on the remote; the worker finds it.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgBrainStore } from "../src/brain/store.js";
import { startWorker, type Worker } from "../src/worker.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

const SETUP = "---\nid: PAGE-ENG-0001\ntitle: Setup\n---\n\n# Setup\n\nStart here.\n";
const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

describe.skipIf(!hasDatabase)("wiki-notify latency (integration)", () => {
  let db: TestDatabase;
  let remote: GitHttpServer;
  let dataDir: string;
  let worker: Worker;

  beforeAll(async () => {
    process.env["KINTSUGI_SECRET_KEY"] ??= randomBytes(32).toString("base64");
    db = await createTestDatabase();
    remote = await startGitHttpServer();
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-wiki-latency-"));
    const storage = new CheckoutStorage(dataDir);
    await remote.createRepository("wiki-docs");
    await remote.commitFiles("wiki-docs", [
      { path: "20-spaces/eng/README.md", content: "---\nkey: ENG\n---\n\n# Engineering\n" },
      { path: "20-spaces/eng/setup.md", content: SETUP },
    ]);
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('internal', 'plain-git', 'Internal', $1, 'none')", [remote.baseUrl]);
    await db.pool.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('wiki-docs', 'internal', $1, 'main')", [`${remote.baseUrl}/wiki-docs.git`]);
    await db.pool.query("insert into admin.project (id, name) values ('wiki', 'Wiki')");
    await db.pool.query("insert into admin.project_repository (project_id, repository_id, role) values ('wiki', 'wiki-docs', 'document')");
    for (const id of ["alice", "bob"]) {
      await db.pool.query("insert into core.app_user (id, username, email, password_hash, password_salt) values ($1, $1, $2, 'x', 'x')", [id, `${id}@example.invalid`]);
      await db.pool.query("insert into admin.project_access (project_id, user_id) values ('wiki', $1)", [id]);
    }
    await db.pool.query("insert into knowledge.wiki_watch (project_id, user_id, scope_kind, target) values ('wiki', 'alice', 'page', 'PAGE-ENG-0001')");
    await new PgBrainStore(db.pool).configure("wiki", { branch: "main", enabled: true, wiki: true }, "alice");
    // The API queues the first build when a Brain is configured; here the worker's own check finds it due instead.
    await db.pool.query("update knowledge.brain_source set state = 'ready' where project_id = 'wiki'");
    // The intervals of a small installation: the review watch and the Brain check every second. The defaults (60 s each) are
    // what the production latency adds on top; the test reports what the pipeline itself costs after the merge is recorded.
    worker = await startWorker({ databaseUrl: db.url, pool: db.pool, storage, pollIntervalSeconds: 3600, pendingScanSeconds: 1, reviewWatchSeconds: 1, brainCheckSeconds: 1, log: () => undefined });
  }, 120_000);
  afterAll(async () => {
    await worker?.stop();
    await remote?.close();
    await db?.drop();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  });

  it("notifies the watcher of a page within 60 seconds of the merge being recorded", async () => {
    const poll = async <T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 90_000): Promise<T> => {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const value = await read();
        if (value !== undefined) return value;
        if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    // The worker syncs, builds the Brain and sets the cursor of the project (the first run tells nobody).
    await poll(async () => ((await db.pool.query("select 1 from knowledge.wiki_notify_cursor where project_id = 'wiki'")).rowCount === 1 ? true : undefined), "the cursor of the first run");

    // A person edits the page: the write goes to a review branch.
    const writeId = randomUUID();
    await db.pool.query("insert into workflow.document_write (id, project_id, kind, status, message, actor, page_path, page_id) values ($1, 'wiki', 'page', 'queued', 'Edit setup', 'bob', '20-spaces/eng/setup.md', 'PAGE-ENG-0001')", [writeId]);
    await worker.requestWrite("wiki-docs", {
      writeId,
      projectId: "wiki",
      kind: "page",
      message: "Edit setup",
      actor: "bob",
      files: [{ path: "20-spaces/eng/setup.md", content: SETUP.replace("Start here.", "Start here, then read on."), expectedHash: sha256(SETUP) }],
      page: { id: "PAGE-ENG-0001", path: "20-spaces/eng/setup.md", minor: false },
    });
    const branchCommit = await poll(async () => {
      const row = (await db.pool.query<{ status: string; branch_commit_sha: string | null }>("select status, branch_commit_sha from workflow.document_write where id = $1", [writeId])).rows[0];
      return row?.status === "committed" && row.branch_commit_sha !== null ? row.branch_commit_sha : undefined;
    }, "the write's branch");
    expect((await db.pool.query("select 1 from core.notification")).rowCount).toBe(0);

    // A person merges it on the server.
    const mergedAt = Date.now();
    remote.git("wiki-docs", "update-ref", "refs/heads/main", branchCommit);

    const recorded = await poll(async () => {
      const row = (await db.pool.query<{ updated_at: Date }>("select updated_at from workflow.document_write where id = $1 and status = 'merged'", [writeId])).rows[0];
      return row?.updated_at;
    }, "the merge to be recorded");
    const notified = await poll(async () => {
      const row = (await db.pool.query<{ created_at: Date; user_id: string; subject: Record<string, string> }>("select created_at, user_id, subject from core.notification")).rows[0];
      return row;
    }, "the notification");

    const latencyMs = notified.created_at.getTime() - recorded.getTime();
    console.log(`wiki-notify latency: merge recorded -> notification row ${latencyMs} ms; merge on the server -> notification row ${Date.now() - mergedAt} ms (review watch and Brain check every 1 s)`);
    expect(notified.user_id).toBe("alice");
    expect(notified.subject).toMatchObject({ pageKey: "PAGE-ENG-0001", actorId: "bob" });
    expect(latencyMs).toBeLessThan(60_000);
  }, 180_000);
});
