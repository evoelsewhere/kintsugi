// A comment tells the people it concerns (ADR-0099 decision 3): whoever it mentions (`wiki-mention`), the author of the
// comment it answers and whoever watches the page, its folders or its space (`wiki-comment`), each once, never the author
// of the comment. A mention of someone without Project Access, or of nobody, is answered exactly as if it were not there.
// The document repo is a real mirror and the Brain is built by the worker's own function.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { RepositoryStore } from "@kintsugi/orchestrator";
import { indexBrain } from "@kintsugi/orchestrator/brain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, currentUserId, grantProjectAccess, memberClient, startTestApp, subRole, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Comment {
  id: string;
  body: string;
}
interface Inbox {
  items: Array<{ id: string; kind: string; page: { key: string; path: string } | null; actor: { username: string }; commentId?: string }>;
  unread: number;
}

const GUIDE = "20-spaces/eng/guide.md";
const HOME = "20-spaces/eng/README.md";
const LOOSE = "30-misc/loose.md";

describe.skipIf(!hasDatabase)("notifications of a comment (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let pool: pg.Pool;
  let ada: Client;
  let adaId: string;
  let grace: Client;
  let graceId: string;
  let kim: Client;
  let kimId: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } }).trim();
  const post = (client: Client, body: Record<string, unknown>, path = GUIDE) => client.request<Comment>("POST", "/projects/shop/wiki/comments", { body: { path, ...body } });
  const inbox = async (client: Client): Promise<Inbox> => (await client.get<Inbox>("/notifications")).body.data!;
  const kinds = async (client: Client): Promise<string[]> => (await inbox(client)).items.map((item) => item.kind).sort();
  const clear = () => app.db.query("delete from core.notification");
  const watch = (client: Client, scopeKind: string, target: string) => client.request("PUT", "/projects/shop/wiki/watches", { body: { scopeKind, target } });
  const unwatchAll = () => app.db.query("delete from knowledge.wiki_watch");

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-comment-notes-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    const work = join(dataDir, "work");
    await mkdir(work);
    git(work, "init", "-q", "-b", "main");
    for (const [path, text] of [
      [HOME, "---\nkey: ENG\n---\n\n# Engineering\n\nThe team's space.\n"],
      [GUIDE, "---\nid: PAGE-ENG-0001\ntitle: Guide\n---\n\n# Guide\n\nSetup steps.\n"],
      [LOOSE, "# Loose\n\nOutside every space.\n"],
    ] as const) {
      await mkdir(dirname(join(work, path)), { recursive: true });
      await writeFile(join(work, path), text);
      git(work, "add", path);
    }
    git(work, "commit", "-q", "-m", "start");
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    execFileSync("git", ["clone", "-q", "--bare", work, new CheckoutStorage(dataDir).mirror("local", "docs")]);

    app = await startTestApp();
    pool = new pg.Pool({ connectionString: app.db.url, max: 2 });
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true } })).status).toBe(200);
    expect(await indexBrain({ pool, repositories: new RepositoryStore(pool), storage: new CheckoutStorage(dataDir), log: () => undefined }, "shop")).toMatchObject({ status: "built" });
    await subRole(admin, "wiki-commenter", ["wiki.comment"]);
    ({ client: ada, id: adaId } = await memberClient(app, admin, "ada", ["user", "wiki-commenter"], ["shop"]));
    ({ client: grace, id: graceId } = await memberClient(app, admin, "grace", ["user", "wiki-commenter"], ["shop"]));
    ({ client: kim, id: kimId } = await memberClient(app, admin, "kim", ["user", "wiki-commenter"], ["shop"]));
    // An outsider: a person of the installation with no Project Access on the shop.
    await memberClient(app, admin, "outsider", ["user"], []);
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("tells the person a comment mentions, with the comment's id and the page, and nobody else", async () => {
    const written = await post(ada, { body: "Could you look at this, @grace?" });
    expect(written.status).toBe(201);
    const hers = await inbox(grace);
    expect(hers.items).toHaveLength(1);
    expect(hers.items[0]).toMatchObject({ kind: "wiki-mention", commentId: written.body.data!.id, page: { key: "PAGE-ENG-0001", path: GUIDE }, actor: { username: "ada" } });
    expect(await kinds(ada)).toEqual([]);
    expect(await kinds(kim)).toEqual([]);
    // The notification holds ids, not the words of the comment.
    const stored = (await app.db.query<{ subject: Record<string, string> }>("select subject from core.notification where user_id = $1", [graceId])).rows[0]!.subject;
    expect(stored).toEqual({ pageKey: "PAGE-ENG-0001", commentId: written.body.data!.id, actorId: adaId });
  });

  it("answers a mention of someone without Project Access, or of nobody, as if there were none, and notifies nobody", async () => {
    await clear();
    const plain = await post(ada, { body: "Nobody is mentioned here." });
    const outsider = await post(ada, { body: "Is @outsider or @nobody-at-all reading this?" });
    expect(plain.status).toBe(201);
    expect(outsider.status).toBe(plain.status);
    expect(Object.keys(outsider.body.data!).sort()).toEqual(Object.keys(plain.body.data!).sort());
    expect((await app.db.query("select 1 from core.notification")).rowCount).toBe(0);
  });

  it("tells the author of the comment an answer replies to, once, and the mention wins when it names that same person", async () => {
    await clear();
    const root = await post(grace, { body: "A question." });
    const answer = await post(kim, { body: "An answer.", parentId: root.body.data!.id });
    expect(answer.status).toBe(201);
    expect((await inbox(grace)).items.map((item) => [item.kind, item.commentId])).toEqual([["wiki-comment", answer.body.data!.id]]);
    expect(await kinds(kim)).toEqual([]);
    const second = await post(kim, { body: "Thanks, @grace, as I said.", parentId: root.body.data!.id });
    expect(await kinds(grace)).toEqual(["wiki-comment", "wiki-mention"]);
    expect(second.status).toBe(201);
  });

  it("tells each watcher of the page, a folder above it or its space once; the author of the comment hears nothing of their own", async () => {
    await clear();
    await watch(grace, "page", "PAGE-ENG-0001");
    await watch(kim, "folder", "20-spaces/eng");
    await watch(ada, "space", "ENG");
    const written = await post(ada, { body: "A change is coming." });
    expect(written.status).toBe(201);
    expect((await inbox(grace)).items.map((item) => [item.kind, item.commentId])).toEqual([["wiki-comment", written.body.data!.id]]);
    expect((await inbox(kim)).items.map((item) => [item.kind, item.commentId])).toEqual([["wiki-comment", written.body.data!.id]]);
    expect(await kinds(ada)).toEqual([]);
    // Watching the page, its folder and its space still tells a person once, and a mention takes the place of the watch.
    await clear();
    await watch(grace, "folder", "20-spaces");
    await watch(grace, "space", "ENG");
    await post(kim, { body: "Attention @grace." });
    expect(await kinds(grace)).toEqual(["wiki-mention"]);
    await clear();
    await post(kim, { body: "Plain again." });
    expect(await kinds(grace)).toEqual(["wiki-comment"]);
    expect(await kinds(ada)).toEqual(["wiki-comment"]);
  });

  it("tells the watchers of a page that has no id by its path, and not those of another page", async () => {
    await unwatchAll();
    await clear();
    await watch(grace, "page", `path:${LOOSE}`);
    await watch(kim, "page", "PAGE-ENG-0001");
    const written = await post(ada, { body: "About the loose page." }, LOOSE);
    expect(written.status).toBe(201);
    expect((await inbox(grace)).items.map((item) => [item.kind, item.page?.path])).toEqual([["wiki-comment", LOOSE]]);
    expect(await kinds(kim)).toEqual([]);
  });

  it("does not tell a watcher who has lost Project Access, and does not tell twice for a repeated comment", async () => {
    await unwatchAll();
    await clear();
    await watch(kim, "page", "PAGE-ENG-0001");
    await app.db.query("delete from admin.project_access where project_id = 'shop' and user_id = $1", [kimId]);
    await post(ada, { body: "Kim cannot read this any more." });
    expect((await app.db.query("select 1 from core.notification where user_id = $1", [kimId])).rowCount).toBe(0);
    await grantProjectAccess(admin, "shop", kimId);

    await clear();
    await watch(grace, "page", "PAGE-ENG-0001");
    const first = await post(ada, { body: "Sent twice by a double click." });
    const again = await post(ada, { body: "Sent twice by a double click." });
    expect(again.body.data!.id).toBe(first.body.data!.id);
    expect(await kinds(grace)).toEqual(["wiki-comment"]);
  });

  it("keeps the comment when writing a notification fails", async () => {
    await unwatchAll();
    await clear();
    await watch(grace, "page", "PAGE-ENG-0001");
    await app.db.query("alter table core.notification rename to notification_away");
    try {
      const written = await post(ada, { body: "Written although nobody can be told." });
      expect(written.status).toBe(201);
      expect((await app.db.query("select 1 from knowledge.wiki_comment where id = $1", [written.body.data!.id])).rowCount).toBe(1);
    } finally {
      await app.db.query("alter table core.notification_away rename to notification");
    }
  });
});
