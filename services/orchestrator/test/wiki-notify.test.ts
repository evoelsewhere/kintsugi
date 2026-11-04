// The wiki-notify job (P3-008, ADR-0099 decision 3, COL-13) against a real git remote, a real mirror, the Brain built by the
// worker's own function and a throwaway database: who is told about a change, who is not, and what the notification holds.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgBrainStore } from "../src/brain/store.js";
import { indexBrain } from "../src/brain/indexer.js";
import { RepositoryStore } from "../src/git-sync/repositories.js";
import { syncRepository } from "../src/git-sync/sync.js";
import type { WikiNotifyRequest } from "../src/queues.js";
import { WIKI_NOTIFY_PAGE_LIMIT, changedPages } from "../src/wiki-notify/changes.js";
import { dueWikiNotifies, notifyWikiWatchers } from "../src/wiki-notify/notify.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

const PAGES: Record<string, string> = {
  "20-spaces/eng/README.md": "---\nkey: ENG\n---\n\n# Engineering\n",
  "20-spaces/eng/setup.md": "---\nid: PAGE-ENG-0001\ntitle: Setup\n---\n\n# Setup\n\nStart here.\n",
  "20-spaces/eng/intro.md": "---\nid: PAGE-ENG-0002\n---\n\n# Intro\n\nHello.\n",
  "20-spaces/eng/runbooks/db.md": "---\nid: PAGE-ENG-0003\n---\n\n# Database\n\nRestore it.\n",
  "20-spaces/eng/plain.md": "# Plain\n\nA page without an id.\n",
  "20-spaces/hr/README.md": "---\nkey: HR\n---\n\n# People\n",
  "20-spaces/hr/leave.md": "---\nid: PAGE-HR-0001\n---\n\n# Leave\n\nSee the plan.\n",
};

describe.skipIf(!hasDatabase)("wiki-notify (integration)", () => {
  let db: TestDatabase;
  let remote: GitHttpServer;
  let dataDir: string;
  let work: string;
  let gitDir: string;
  let deps: Parameters<typeof indexBrain>[0];
  let requests: WikiNotifyRequest[];
  let edit = 0;
  const sql = (text: string, values: unknown[] = []) => db.pool.query(text, values);
  const git = (...args: string[]): string => execFileSync("git", ["-C", work, "-c", "core.autocrlf=false", ...args], { encoding: "utf8" });

  /** One commit on main by `email` (and with the trailer lines of `message`), pushed to the remote, mirrored and indexed. */
  async function commit(changes: { write?: Record<string, string>; remove?: string[]; rename?: Array<[string, string]> }, who: { name?: string; email?: string; message?: string } = {}): Promise<string> {
    for (const [path, content] of Object.entries(changes.write ?? {})) {
      await mkdir(dirname(join(work, path)), { recursive: true });
      await writeFile(join(work, path), content);
    }
    for (const path of changes.remove ?? []) git("rm", "-q", path);
    for (const [from, to] of changes.rename ?? []) {
      await mkdir(dirname(join(work, to)), { recursive: true });
      git("mv", from, to);
    }
    git("add", "-A");
    git("-c", `user.name=${who.name ?? "Fixture"}`, "-c", `user.email=${who.email ?? "fixture@example.invalid"}`, "commit", "-q", "-m", who.message ?? `edit ${(edit += 1)}`);
    git("push", "-q", gitDir, "HEAD:main");
    const sha = git("rev-parse", "HEAD").trim();
    await syncRepository({ store: deps.repositories, storage: deps.storage }, "wiki-docs");
    expect(await indexBrain(deps, "wiki")).toMatchObject({ status: "built", commit: sha });
    return sha;
  }
  const notifications = async () => (await sql("select user_id, kind, subject, dedupe_key from core.notification order by user_id, dedupe_key")).rows as Array<{ user_id: string; kind: string; subject: Record<string, string>; dedupe_key: string }>;
  const told = async (): Promise<string[]> => [...new Set((await notifications()).map((row) => row.user_id))].sort();
  const run = async (sha: string) => notifyWikiWatchers(deps, "wiki", sha);
  const watch = (user: string, scopeKind: string, target: string) => sql("insert into knowledge.wiki_watch (project_id, user_id, scope_kind, target) values ('wiki', $1, $2, $3) on conflict do nothing", [user, scopeKind, target]);

  beforeAll(async () => {
    process.env["KINTSUGI_SECRET_KEY"] ??= randomBytes(32).toString("base64");
    db = await createTestDatabase();
    remote = await startGitHttpServer();
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-wiki-notify-"));
    const storage = new CheckoutStorage(dataDir);
    await storage.prepare();
    requests = [];
    deps = { pool: db.pool, repositories: new RepositoryStore(db.pool), storage, log: () => undefined, requestWikiNotify: async (request) => void requests.push(request) };
    await remote.createRepository("wiki-docs");
    await remote.commitFiles("wiki-docs", Object.entries(PAGES).map(([path, content]) => ({ path, content })));
    gitDir = remote.git("wiki-docs", "rev-parse", "--absolute-git-dir").trim();
    work = await mkdtemp(join(tmpdir(), "kintsugi-wiki-notify-work-"));
    execFileSync("git", ["clone", "-q", "-c", "core.autocrlf=false", gitDir, work]);
    git("checkout", "-q", "main");
    await sql("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('internal', 'plain-git', 'Internal', $1, 'none')", [remote.baseUrl]);
    await sql("insert into admin.git_repository (id, server_id, url, default_branch) values ('wiki-docs', 'internal', $1, 'main')", [`${remote.baseUrl}/wiki-docs.git`]);
    await sql("insert into admin.project (id, name) values ('wiki', 'Wiki')");
    await sql("insert into admin.project_repository (project_id, repository_id, role) values ('wiki', 'wiki-docs', 'document')");
    await syncRepository({ store: deps.repositories, storage }, "wiki-docs");
    for (const [id, enabled] of [["alice", true], ["bob", true], ["carol", true], ["dave", true], ["erin", true], ["frank", false], ["gina", true]] as const) {
      await sql("insert into core.app_user (id, username, email, password_hash, password_salt, enabled) values ($1, $1, $2, 'x', 'x', $3)", [id, `${id}@example.invalid`, enabled]);
    }
    // carol lost her Project Access; everybody else has it.
    for (const id of ["alice", "bob", "dave", "erin", "frank", "gina"]) await sql("insert into admin.project_access (project_id, user_id) values ('wiki', $1)", [id]);
    await new PgBrainStore(db.pool).configure("wiki", { branch: "main", enabled: true, wiki: true }, "alice");
  }, 120_000);
  afterAll(async () => {
    await remote?.close();
    await db?.drop();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
    if (work !== undefined) await rm(work, { recursive: true, force: true });
  });

  it("asks for the notification after a build of a wiki project, not inside it, and never fails the build for it", async () => {
    const built = await indexBrain(deps, "wiki");
    expect(built).toMatchObject({ status: "built", mode: "whole" });
    expect(requests).toEqual([{ projectId: "wiki", from: null, to: built.status === "built" ? built.commit : "" }]);
    // A request that fails changes nothing about the build.
    const failing = { ...deps, requestWikiNotify: async () => Promise.reject(new Error("queue is down")) };
    await sql("update knowledge.brain_source set indexed_commit = null where project_id = 'wiki'");
    expect(await indexBrain(failing, "wiki")).toMatchObject({ status: "built", commit: built.status === "built" ? built.commit : "" });
    expect((await new PgBrainStore(db.pool).source("wiki"))?.state).toBe("ready");
    // A project that is not a wiki asks for nothing.
    await new PgBrainStore(db.pool).setWiki("wiki", false, "alice");
    requests.length = 0;
    await sql("update knowledge.brain_source set indexed_commit = null where project_id = 'wiki'");
    expect(await indexBrain(deps, "wiki")).toMatchObject({ status: "built" });
    expect(requests).toEqual([]);
    await new PgBrainStore(db.pool).setWiki("wiki", true, "alice");
  });

  it("only sets the cursor the first time, and tells nobody", async () => {
    await watch("alice", "page", "PAGE-ENG-0001");
    const head = git("rev-parse", "HEAD").trim();
    expect((await dueWikiNotifies(deps)).map((due) => [due.projectId, due.from, due.to])).toEqual([["wiki", null, head]]);
    expect(await run(head)).toMatchObject({ status: "skipped" });
    expect(await sql("select notified_commit from knowledge.wiki_notify_cursor where project_id = 'wiki'").then((result) => result.rows)).toEqual([{ notified_commit: head }]);
    expect(await notifications()).toEqual([]);
    expect(await dueWikiNotifies(deps)).toEqual([]);
  });

  it("tells the watchers of a page, its folder and its space about a change, with ids only, and not the one who made it", async () => {
    await watch("alice", "page", "PAGE-ENG-0001"); // the page itself, by its id
    await watch("bob", "page", "PAGE-ENG-0001"); // the author: never told about his own change
    await watch("carol", "page", "PAGE-ENG-0001"); // no Project Access any more
    await watch("frank", "page", "PAGE-ENG-0001"); // disabled
    await watch("dave", "folder", "20-spaces/eng"); // a folder above the page
    await watch("erin", "space", "ENG"); // its space
    await watch("gina", "page", "PAGE-HR-0001"); // another page: not told
    const sha = await commit({ write: { "20-spaces/eng/setup.md": "---\nid: PAGE-ENG-0001\ntitle: Setup\n---\n\n# Setup\n\nStart here, edited with the secret word: PINEAPPLE.\n" } }, { name: "Bob", email: "Bob@Example.invalid" });
    // The change feed hears the three people it is for, as it does for a notification the API makes.
    const listener = new pg.Client({ connectionString: db.url });
    await listener.connect();
    const heard: string[] = [];
    listener.on("notification", (message) => heard.push(message.payload ?? ""));
    await listener.query("listen kintsugi_change");
    expect(await run(sha)).toMatchObject({ status: "notified", pages: 1, notifications: 3 });
    await expect.poll(() => heard.filter((payload) => payload.includes('"notifications"')).sort(), { timeout: 5000 }).toEqual([
      '{"t" : "notifications", "s" : "alice"}',
      '{"t" : "notifications", "s" : "dave"}',
      '{"t" : "notifications", "s" : "erin"}',
    ]);
    await listener.end();
    expect(await told()).toEqual(["alice", "dave", "erin"]);
    const rows = await notifications();
    for (const row of rows) {
      expect(row.kind).toBe("wiki-page-changed");
      expect(row.subject).toEqual({ pageKey: "PAGE-ENG-0001", commit: sha, actorId: "bob" });
      expect(row.dedupe_key).toBe(`wiki-page-changed:${row.user_id}:PAGE-ENG-0001:${sha}`);
      // Ids only: no title, no path, no word of the page.
      expect(JSON.stringify(row)).not.toMatch(/PINEAPPLE|Setup|setup\.md|20-spaces/);
    }
    expect(await sql("select notified_commit from knowledge.wiki_notify_cursor").then((result) => result.rows)).toEqual([{ notified_commit: sha }]);
  });

  it("makes no second notification for a range it was run on twice, even with the cursor put back", async () => {
    const before = (await notifications()).length;
    const head = git("rev-parse", "HEAD").trim();
    expect(await run(head)).toMatchObject({ status: "skipped" });
    // The cursor behind again, as after a run that failed after it made the notifications: the keys make the second run a no-op.
    await sql("update knowledge.wiki_notify_cursor set notified_commit = $1 where project_id = 'wiki'", [git("rev-parse", "HEAD~1").trim()]);
    expect(await run(head)).toMatchObject({ status: "notified", pages: 1, notifications: 0 });
    expect((await notifications()).length).toBe(before);
  });

  it("does not tell about a page nobody watches", async () => {
    const before = (await notifications()).length;
    const sha = await commit({ write: { "20-spaces/hr/leave.md": "---\nid: PAGE-HR-0001\n---\n\n# Leave\n\nChanged.\n" } });
    // gina watches PAGE-HR-0001, so she is told; nobody else watches it, not even through the space HR.
    expect(await run(sha)).toMatchObject({ status: "notified", notifications: 1 });
    expect((await notifications()).length).toBe(before + 1);
    expect((await notifications()).filter((row) => row.subject["commit"] === sha).map((row) => row.user_id)).toEqual(["gina"]);
    const quiet = await commit({ write: { "20-spaces/eng/intro.md": "---\nid: PAGE-ENG-0002\n---\n\n# Intro\n\nChanged.\n" } }, { email: "erin@example.invalid" });
    // erin watches the space but made this change; dave watches the folder and is told; alice does not watch this page.
    expect(await run(quiet)).toMatchObject({ status: "notified", notifications: 1 });
    expect((await notifications()).filter((row) => row.subject["commit"] === quiet).map((row) => row.user_id)).toEqual(["dave"]);
  });

  it("knows the author by the Kintsugi-Actor trailer and by the write that brought the commit in", async () => {
    const trailer = await commit({ write: { "20-spaces/eng/intro.md": "---\nid: PAGE-ENG-0002\n---\n\n# Intro\n\nBy trailer.\n" } }, { name: "Kintsugi", email: "kintsugi@example.invalid", message: "Publish intro\n\nKintsugi-Actor: dave\nKintsugi-Page: PAGE-ENG-0002" });
    expect(await run(trailer)).toMatchObject({ status: "notified", notifications: 1 });
    expect((await notifications()).filter((row) => row.subject["commit"] === trailer).map((row) => [row.user_id, row.subject["actorId"]])).toEqual([["erin", "dave"]]);
    const written = await commit({ write: { "20-spaces/eng/intro.md": "---\nid: PAGE-ENG-0002\n---\n\n# Intro\n\nBy a write.\n" } }, { name: "Kintsugi", email: "kintsugi@example.invalid", message: "Merged pull request" });
    await sql("insert into workflow.document_write (id, project_id, kind, status, message, actor, merge_commit, page_path) values ('w1', 'wiki', 'page', 'committed', 'Intro', 'erin', $1, '20-spaces/eng/intro.md')", [written]);
    expect(await run(written)).toMatchObject({ status: "notified", notifications: 1 });
    expect((await notifications()).filter((row) => row.subject["commit"] === written).map((row) => [row.user_id, row.subject["actorId"]])).toEqual([["dave", "erin"]]);
  });

  it("follows a page that was moved, deleted or never had an id, and ignores what is not a wiki page", async () => {
    await watch("alice", "page", "path:20-spaces/eng/plain.md"); // watched before it had an id
    await watch("gina", "page", "PAGE-ENG-0003");
    const sha = await commit({
      write: { "20-spaces/eng/plain.md": "# Plain\n\nEdited.\n", "restricted/secret.md": "# No\n", "scratch/x.md": "# No\n", "20-spaces/eng/notes.txt": "no\n" },
      rename: [["20-spaces/eng/runbooks/db.md", "20-spaces/eng/database.md"]],
      remove: ["20-spaces/eng/setup.md"],
    });
    const { changes } = await changedPages(deps.storage.mirror("internal", "wiki-docs"), git("rev-parse", `${sha}~1`).trim(), sha);
    expect(changes.map((change) => [change.kind, change.path, change.pageId ?? null])).toEqual([
      ["renamed", "20-spaces/eng/database.md", "PAGE-ENG-0003"],
      ["modified", "20-spaces/eng/plain.md", null],
      ["deleted", "20-spaces/eng/setup.md", "PAGE-ENG-0001"],
    ]);
    expect(await run(sha)).toMatchObject({ status: "notified", pages: 3 });
    const rows = (await notifications()).filter((row) => row.subject["commit"] === sha);
    // The renamed page keeps its id (gina's watch by id still holds), the page without an id is watched by its path,
    // the deleted one is told to the watchers of its id, its folder and its space (carol and frank are never told).
    expect(rows.map((row) => [row.user_id, row.subject["pageKey"]]).sort()).toEqual([
      ["alice", "PAGE-ENG-0001"],
      ["alice", "path:20-spaces/eng/plain.md"],
      ["bob", "PAGE-ENG-0001"], // he made the first change to this page, not this one
      ["dave", "PAGE-ENG-0001"],
      ["dave", "PAGE-ENG-0003"],
      ["dave", "path:20-spaces/eng/plain.md"],
      ["erin", "PAGE-ENG-0001"],
      ["erin", "PAGE-ENG-0003"],
      ["erin", "path:20-spaces/eng/plain.md"],
      ["gina", "PAGE-ENG-0003"],
    ]);
  });

  it("cuts a change of more than 200 pages and says so", async () => {
    const many: Record<string, string> = {};
    for (let n = 0; n < WIKI_NOTIFY_PAGE_LIMIT + 30; n += 1) many[`20-spaces/hr/bulk/p${String(n).padStart(3, "0")}.md`] = `# Page ${n}\n`;
    await watch("gina", "folder", "20-spaces/hr/bulk");
    const sha = await commit({ write: many });
    const messages: string[] = [];
    const outcome = await notifyWikiWatchers({ ...deps, log: (message) => messages.push(message) }, "wiki", sha);
    expect(outcome).toMatchObject({ status: "notified", pages: WIKI_NOTIFY_PAGE_LIMIT, notifications: WIKI_NOTIFY_PAGE_LIMIT, cut: 30 });
    expect(messages.some((message) => message.includes("230 pages changed") && message.includes("30 are left out"))).toBe(true);
  });

  it("sets the cursor and tells nobody when the history was rewritten, and ignores a request older than the cursor", async () => {
    const head = git("rev-parse", "HEAD").trim();
    const older = git("rev-parse", "HEAD~3").trim();
    const before = (await notifications()).length;
    expect(await run(older)).toMatchObject({ status: "skipped", reason: "the watchers were told past this commit" });
    await sql("update knowledge.wiki_notify_cursor set notified_commit = $1 where project_id = 'wiki'", ["0123456789abcdef0123456789abcdef01234567"]);
    expect(await run(head)).toMatchObject({ status: "skipped", reason: "the history was rewritten" });
    expect((await sql("select notified_commit from knowledge.wiki_notify_cursor")).rows).toEqual([{ notified_commit: head }]);
    expect((await notifications()).length).toBe(before);
  });

  it("tells nothing for a project whose wiki is off", async () => {
    await new PgBrainStore(db.pool).setWiki("wiki", false, "alice");
    expect(await run(git("rev-parse", "HEAD").trim())).toMatchObject({ status: "skipped", reason: "the project's wiki is not on" });
    expect(await dueWikiNotifies(deps)).toEqual([]);
    await new PgBrainStore(db.pool).setWiki("wiki", true, "alice");
  });
});
