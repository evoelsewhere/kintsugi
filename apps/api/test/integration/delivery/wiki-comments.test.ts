// Comments on wiki pages (ADR-0099 decision 1, migration 057): rows of the database anchored to a passage checked against
// the page as the Brain indexed it, or to the page as a whole; answers one level deep; no double comment from a double
// click; 200 open comments a page; read with Project Access, written with wiki.comment. The document repo is a real
// mirror and the Brain is built by the worker's own function.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { RepositoryStore } from "@kintsugi/orchestrator";
import { indexBrain } from "@kintsugi/orchestrator/brain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, currentUserId, grantProjectAccess, memberClient, startTestApp, subRole, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface View {
  id: string;
  parentId: string | null;
  author: { id: string; username: string; displayName: string };
  body: string;
  createdAt: string;
  editedAt: string | null;
  resolved: boolean;
  deleted: boolean;
  node: string | null;
  status: string;
  line: number | null;
  quote: string | null;
}
interface List {
  page: { key: string; path: string };
  comments: View[];
  next: string | null;
}

const MIGRATION = resolve(import.meta.dirname, "../../../migrations/057_wiki_comment.sql");
const GUIDE = "20-spaces/eng/guide.md";
const LOOSE = "30-misc/loose.md";
const GUIDE_TEXT = "---\nid: PAGE-ENG-0001\ntitle: Guide\n---\n\nIntroduction before any heading, with the **word** here.\n\n## Setup\n\nInstall the package first, then run the [setup script](setup.md) twice.\n\n## Usage\n\nCall the service with a token.\n";

describe.skipIf(!hasDatabase)("wiki comments (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let pool: pg.Pool;
  let ada: Client;
  let adaId: string;
  let grace: Client;
  let reader: Client;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } }).trim();
  const build = () => indexBrain({ pool, repositories: new RepositoryStore(pool), storage: new CheckoutStorage(dataDir), log: () => undefined }, "shop");
  const post = (client: Client, body: Record<string, unknown>) => client.request<View>("POST", "/projects/shop/wiki/comments", { body: { path: GUIDE, ...body } });
  const list = async (client: Client, path = GUIDE, query = "") => (await client.get<List>(`/projects/shop/wiki/comments?path=${encodeURIComponent(path)}${query}`)).body.data!;
  const count = async () => (await app.db.query<{ n: number }>("select count(*)::int as n from knowledge.wiki_comment")).rows[0]!.n;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-comments-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    const work = join(dataDir, "work");
    await mkdir(work);
    git(work, "init", "-q", "-b", "main");
    for (const [path, text] of [
      [GUIDE, GUIDE_TEXT],
      [LOOSE, "# Loose\n\nNobody gave this page an id.\n"],
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
    await subRole(admin, "wiki-commenter", ["wiki.comment"]);
    ({ client: ada, id: adaId } = await memberClient(app, admin, "ada", ["user", "wiki-commenter"], ["shop"]));
    ({ client: grace } = await memberClient(app, admin, "grace", ["user", "wiki-commenter"], ["shop"]));
    ({ client: reader } = await memberClient(app, admin, "reader-r", ["user"], ["shop"]));
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("runs migration 057 again without error and creates the comment and mention tables", async () => {
    const script = await readFile(MIGRATION, "utf8");
    await app.db.query(script);
    await app.db.query(script);
    const tables = await app.db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'knowledge' and table_name like 'wiki\\_comment%' order by 1");
    expect(tables.rows.map((row) => row.table_name)).toEqual(["wiki_comment", "wiki_comment_mention"]);
    const indexes = await app.db.query<{ indexname: string }>("select indexname from pg_indexes where indexname in ('wiki_comment_page_idx', 'wiki_comment_parent_idx', 'wiki_comment_mention_user_idx') order by 1");
    expect(indexes.rows).toHaveLength(3);
    await expect(app.db.query("insert into knowledge.wiki_comment (project_id, page_key, path_at_write, author_id, body) values ('shop', 'k', 'p.md', $1, $2)", [adaId, "x".repeat(8001)])).rejects.toThrow(/check constraint/);
    await expect(app.db.query("insert into knowledge.wiki_comment (project_id, page_key, path_at_write, author_id, body, status) values ('shop', 'k', 'p.md', $1, 'x', 'done')", [adaId])).rejects.toThrow(/check constraint/);
  });

  it("comments on the page as a whole: the author's names, open, not deleted, no node, no quote; before the Brain is built", async () => {
    const written = await post(ada, { body: "A question about the whole page." });
    expect(written.status).toBe(201);
    expect(written.body.data).toMatchObject({ parentId: null, author: { id: adaId, username: "ada", displayName: "ada" }, body: "A question about the whole page.", editedAt: null, resolved: false, deleted: false, node: null, status: "anchored", line: null, quote: null });
    const seen = await list(reader);
    expect(seen.page).toEqual({ key: "PAGE-ENG-0001", path: GUIDE });
    expect(seen.comments.map((comment) => comment.body)).toEqual(["A question about the whole page."]);
    // An inline comment needs the Brain: it is not built yet.
    expect((await post(ada, { body: "On a passage.", anchor: { node: "setup", exact: "Install the package first" } })).status).toBe(409);
  });

  it("anchors a comment to a passage that is in the page as the Brain indexed it, and records that commit", async () => {
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true } })).status).toBe(200);
    expect(await build()).toMatchObject({ status: "built" });
    const indexed = (await app.db.query<{ indexed_commit: string }>("select indexed_commit from knowledge.brain_source where project_id = 'shop'")).rows[0]!.indexed_commit;

    const inline = await post(ada, { body: "Which package?", anchor: { node: "setup", exact: "Install the package first", prefix: "## Setup ", suffix: ", then run" } });
    expect(inline.status).toBe(201);
    expect(inline.body.data).toMatchObject({ node: "setup", quote: "Install the package first", status: "anchored" });
    expect(inline.body.data!.line).toBeGreaterThan(0);
    const stored = (await app.db.query<{ anchor: { node: string; exact: string; prefix: string; suffix: string; commit: string } }>("select anchor from knowledge.wiki_comment where id = $1", [inline.body.data!.id])).rows[0]!.anchor;
    expect(stored).toEqual({ node: "setup", exact: "Install the package first", prefix: "## Setup ", suffix: ", then run", commit: indexed });

    // The text a reader selects has no Markdown marks: a link by its words, whitespace as it falls.
    const linked = await post(ada, { body: "Twice?", anchor: { node: `${GUIDE}#setup`, exact: "run the setup script   twice" } });
    expect(linked.status).toBe(201);
    expect(linked.body.data).toMatchObject({ node: "setup", quote: "run the setup script   twice" });
    // Before the first heading the node is the page path.
    const intro = await post(ada, { body: "Which word?", anchor: { node: GUIDE, exact: "with the word here" } });
    expect(intro.status).toBe(201);
    expect(intro.body.data).toMatchObject({ node: GUIDE, status: "anchored" });
  });

  it("refuses a passage the page does not hold, a heading it does not have, and a bad anchor, each with a 400", async () => {
    const before = await count();
    for (const anchor of [
      { node: "setup", exact: "Words nobody wrote" },
      { node: "no-such-heading", exact: "Install the package first" },
      { node: "setup", exact: "" },
      { node: "setup", exact: "x".repeat(501) },
      { node: "setup", exact: "Install", prefix: "p".repeat(65) },
      { node: "", exact: "Install" },
      { node: "setup", exact: "Install", extra: 1 },
    ]) {
      expect((await post(ada, { body: "Comment", anchor })).status, JSON.stringify(anchor).slice(0, 60)).toBe(400);
    }
    expect(await count()).toBe(before);
  });

  it("takes an answer to a comment of the page, one level deep, and refuses the rest", async () => {
    const top = (await post(ada, { body: "Top comment for answers." })).body.data!;
    const answer = await post(grace, { body: "An answer.", parentId: top.id });
    expect(answer.status).toBe(201);
    expect(answer.body.data).toMatchObject({ parentId: top.id, author: { username: "grace" }, node: null });
    const refuse = async (body: Record<string, unknown>, path?: string) => (await post(grace, path === undefined ? body : { ...body, path })).status;
    expect(await refuse({ body: "To an answer", parentId: answer.body.data!.id })).toBe(400);
    expect(await refuse({ body: "With an anchor", parentId: top.id, anchor: { node: "setup", exact: "Install the package first" } })).toBe(400);
    expect(await refuse({ body: "Unknown parent", parentId: "00000000-0000-4000-8000-000000000000" })).toBe(400);
    expect(await refuse({ body: "Not a uuid", parentId: "nope" })).toBe(400);
    expect(await refuse({ body: "On another page", parentId: top.id }, LOOSE)).toBe(400);
    await app.db.query("update knowledge.wiki_comment set deleted_at = now() where id = $1", [top.id]);
    expect(await refuse({ body: "To a deleted comment", parentId: top.id })).toBe(400);
    await app.db.query("update knowledge.wiki_comment set deleted_at = null where id = $1", [top.id]);
  });

  it("refuses an empty comment, one over 8000 characters, a page that is not there, and what is not a page", async () => {
    expect((await post(ada, { body: "   " })).status).toBe(400);
    expect((await post(ada, { body: "x".repeat(8001) })).status).toBe(400);
    expect((await post(ada, { body: "x".repeat(8000) })).status).toBe(201);
    expect((await post(ada, { body: "Nowhere", path: "20-spaces/eng/missing.md" })).status).toBe(404);
    expect((await post(ada, { body: "Not a page", path: "20-spaces/eng/notes.txt" })).status).toBe(400);
    expect((await post(ada, { body: "Private", path: "restricted/vault.md" })).status).toBe(403);
    expect((await post(ada, { body: "Extra", extra: 1 })).status).toBe(400);
    expect((await ada.get(`/projects/shop/wiki/comments?path=${encodeURIComponent("20-spaces/eng/missing.md")}`)).status).toBe(404);
  });

  it("keys a page by its id, or by its path when it has none", async () => {
    const loose = await post(ada, { body: "On a page without an id.", path: LOOSE });
    expect(loose.status).toBe(201);
    expect((await list(reader, LOOSE)).page).toEqual({ key: `path:${LOOSE}`, path: LOOSE });
    expect((await list(reader, LOOSE)).comments.map((comment) => comment.body)).toEqual(["On a page without an id."]);
    expect((await app.db.query<{ page_key: string; path_at_write: string }>("select page_key, path_at_write from knowledge.wiki_comment where id = $1", [loose.body.data!.id])).rows[0]).toEqual({ page_key: `path:${LOOSE}`, path_at_write: LOOSE });
  });

  it("returns the first comment for the same words sent again within five seconds, once a second only when they are new", async () => {
    const same = { body: "Sent twice by a double click." };
    const first = await post(ada, same);
    const again = await post(ada, same);
    expect(again.body.data!.id).toBe(first.body.data!.id);
    // Another person, another text, another page or an answer are not the same comment.
    expect((await post(grace, same)).body.data!.id).not.toBe(first.body.data!.id);
    expect((await post(ada, { body: "Sent twice by a double click!" })).body.data!.id).not.toBe(first.body.data!.id);
    expect((await post(ada, { ...same, path: LOOSE })).body.data!.id).not.toBe(first.body.data!.id);
    expect((await post(ada, { ...same, parentId: first.body.data!.id })).body.data!.id).not.toBe(first.body.data!.id);
    // Five seconds later it is a new comment.
    await app.db.query("update knowledge.wiki_comment set created_at = now() - interval '6 seconds' where id = $1", [first.body.data!.id]);
    expect((await post(ada, same)).body.data!.id).not.toBe(first.body.data!.id);
    // Five clicks at the same moment make one comment.
    const before = await count();
    const clicks = await Promise.all([1, 2, 3, 4, 5].map(() => post(ada, { body: "Five clicks at once." })));
    expect(new Set(clicks.map((click) => click.body.data!.id)).size).toBe(1);
    expect(await count()).toBe(before + 1);
  });

  it("takes 200 open comments a page and answers the next with a 409 too-many; a resolved one makes room", async () => {
    await app.db.query("delete from knowledge.wiki_comment");
    await app.db.query("insert into knowledge.wiki_comment (project_id, page_key, path_at_write, author_id, body) select 'shop', 'PAGE-ENG-0001', $2, $1, 'Comment ' || g from generate_series(1, 199) g", [adaId, GUIDE]);
    expect((await post(ada, { body: "The two hundredth." })).status).toBe(201);
    const over = await post(ada, { body: "The two hundred and first." });
    expect(over.status).toBe(409);
    expect(over.body).toMatchObject({ details: { code: "too-many", limit: 200 } });
    // Other pages are not full; resolved and deleted comments do not count.
    expect((await post(ada, { body: "Elsewhere.", path: LOOSE })).status).toBe(201);
    await app.db.query("update knowledge.wiki_comment set status = 'resolved' where body = 'Comment 1'");
    expect((await post(ada, { body: "Room again." })).status).toBe(201);
    await app.db.query("update knowledge.wiki_comment set deleted_at = now() where body = 'Comment 2'");
    expect((await post(ada, { body: "Room once more." })).status).toBe(201);
  });

  it("lists in time order, a page at a time, and a deleted comment only while an answer to it is", async () => {
    await app.db.query("delete from knowledge.wiki_comment");
    const insert = async (body: string, offset: number, parent: string | null = null): Promise<string> =>
      (await app.db.query<{ id: string }>("insert into knowledge.wiki_comment (project_id, page_key, path_at_write, author_id, body, parent_id, created_at) values ('shop', 'PAGE-ENG-0001', $1, $2, $3, $4, now() + make_interval(secs => $5)) returning id", [GUIDE, adaId, body, parent, offset])).rows[0]!.id;
    const gone = await insert("deleted with an answer", 1);
    await insert("an answer", 2, gone);
    const alone = await insert("deleted alone", 3);
    await insert("three", 4);
    await insert("four", 5);
    await app.db.query("update knowledge.wiki_comment set deleted_at = now() where id in ($1, $2)", [gone, alone]);

    const all = await list(reader);
    expect(all.comments.map((comment) => `${comment.body}|${comment.deleted}`)).toEqual(["|true", "an answer|false", "three|false", "four|false"]);
    const first = await list(reader, GUIDE, "&limit=2");
    expect(first.comments.map((comment) => comment.body)).toEqual(["", "an answer"]);
    expect(first.next).not.toBeNull();
    const second = await list(reader, GUIDE, `&limit=2&after=${first.next}`);
    expect(second.comments.map((comment) => comment.body)).toEqual(["three", "four"]);
    expect(second.next).toBeNull();
    expect((await ada.get(`/projects/shop/wiki/comments?path=${GUIDE}&limit=101`)).status).toBe(400);
    expect((await ada.get(`/projects/shop/wiki/comments?path=${GUIDE}&after=nope`)).status).toBe(400);
  });

  it("reads with Project Access alone, writes with wiki.comment, and refuses an administrator without a grant", async () => {
    const refused = await post(reader, { body: "May I?" });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain("wiki.comment");
    expect((await list(reader)).page.key).toBe("PAGE-ENG-0001");
    const { client: outsider } = await memberClient(app, admin, "outsider", ["user", "wiki-commenter"], []);
    await app.db.query("delete from admin.project_access where project_id = 'shop' and user_id = $1", [await currentUserId(admin)]);
    for (const client of [outsider, admin]) {
      expect((await post(client, { body: "Hello" })).status).toBe(403);
      expect((await client.get(`/projects/shop/wiki/comments?path=${GUIDE}`)).status).toBe(403);
    }
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
  });
});
