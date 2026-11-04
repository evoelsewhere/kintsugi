// Watches (ADR-0099 decision 3, migration 058): a person's own list of pages, folders and spaces. A page that has an id is
// watched by its id, so a move keeps the watch; a folder or a space the Brain does not know is refused; only the caller's
// watches are reachable; 500 a person and project. The document repo is a real mirror and the Brain is built by the
// worker's own function.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { RepositoryStore } from "@kintsugi/orchestrator";
import { indexBrain } from "@kintsugi/orchestrator/brain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, currentUserId, grantProjectAccess, memberClient, startTestApp, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface WatchView {
  scopeKind: string;
  target: string;
  createdAt: string;
  path: string | null;
  title: string | null;
}
interface PageWatch {
  path: string;
  watched: boolean;
  direct: boolean;
  via: { scopeKind: string; target: string } | null;
}

const MIGRATION = resolve(import.meta.dirname, "../../../migrations/058_wiki_watch_notification.sql");
const HOME = "20-spaces/eng/README.md";
const GUIDE = "20-spaces/eng/guide.md";
const DB = "20-spaces/eng/runbooks/db.md";
const LOOSE = "30-misc/loose.md";

describe.skipIf(!hasDatabase)("wiki watches (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let work: string;
  let mirror: string;
  let pool: pg.Pool;
  let ada: Client;
  let adaId: string;
  let grace: Client;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const git = (...args: string[]): string => execFileSync("git", args, { cwd: work, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } }).trim();
  const put = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(work, path)), { recursive: true });
    await writeFile(join(work, path), text);
    git("add", path);
  };
  const build = () => indexBrain({ pool, repositories: new RepositoryStore(pool), storage: new CheckoutStorage(dataDir), log: () => undefined }, "shop");
  const watch = (client: Client, scopeKind: string, target: string) => client.request<WatchView>("PUT", "/projects/shop/wiki/watches", { body: { scopeKind, target } });
  const unwatch = (client: Client, scopeKind: string, target: string) => client.request("DELETE", `/projects/shop/wiki/watches?scopeKind=${scopeKind}&target=${encodeURIComponent(target)}`);
  const list = async (client: Client) => (await client.get<WatchView[]>("/projects/shop/wiki/watches")).body.data!;
  const of = async (client: Client, path: string) => (await client.get<PageWatch>(`/projects/shop/wiki/watches?path=${encodeURIComponent(path)}`)).body.data!;
  const rows = async () => (await app.db.query<{ scope_kind: string; target: string }>("select scope_kind, target from knowledge.wiki_watch order by scope_kind, target")).rows.map((row) => `${row.scope_kind}:${row.target}`);

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-watch-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    work = join(dataDir, "work");
    await mkdir(work);
    git("init", "-q", "-b", "main");
    await put(HOME, "---\nkey: ENG\n---\n\n# Engineering\n\nThe team's space.\n");
    await put(GUIDE, "---\nid: PAGE-ENG-0001\ntitle: Guide\n---\n\n# Guide\n\nSetup steps.\n");
    await put(DB, "# Database\n\nFail over the database.\n");
    await put(LOOSE, "# Loose\n\nOutside every space.\n");
    git("commit", "-q", "-m", "start");
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    mirror = new CheckoutStorage(dataDir).mirror("local", "docs");
    execFileSync("git", ["clone", "-q", "--bare", work, mirror]);

    app = await startTestApp();
    pool = new pg.Pool({ connectionString: app.db.url, max: 2 });
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
    ({ client: ada, id: adaId } = await memberClient(app, admin, "ada", ["user"], ["shop"]));
    ({ client: grace } = await memberClient(app, admin, "grace", ["user"], ["shop"]));
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("runs migration 058 again without error and creates the watch, notification and cursor tables", async () => {
    const script = await readFile(MIGRATION, "utf8");
    await app.db.query(script);
    await app.db.query(script);
    const tables = await app.db.query<{ table_schema: string; table_name: string }>("select table_schema, table_name from information_schema.tables where (table_schema, table_name) in (('knowledge', 'wiki_watch'), ('core', 'notification'), ('knowledge', 'wiki_notify_cursor')) order by 1, 2");
    expect(tables.rows.map((row) => `${row.table_schema}.${row.table_name}`)).toEqual(["core.notification", "knowledge.wiki_notify_cursor", "knowledge.wiki_watch"]);
    const indexes = await app.db.query<{ indexname: string }>("select indexname from pg_indexes where indexname in ('wiki_watch_target_idx', 'notification_user_idx') order by 1");
    expect(indexes.rows.map((row) => row.indexname)).toEqual(["notification_user_idx", "wiki_watch_target_idx"]);
    // A notification is once per dedupe key, of a known kind, and goes with its person.
    const insert = (kind: string, key: string) => app.db.query("insert into core.notification (user_id, project_id, kind, dedupe_key) values ($1, 'shop', $2, $3)", [adaId, kind, key]);
    await insert("wiki-comment", "wiki-comment:ada:c1:-");
    await expect(insert("wiki-comment", "wiki-comment:ada:c1:-")).rejects.toThrow(/duplicate key/);
    await expect(insert("wiki-gossip", "x")).rejects.toThrow(/check constraint/);
    await app.db.query("delete from core.notification");
    await expect(app.db.query("insert into knowledge.wiki_watch (project_id, user_id, scope_kind, target) values ('shop', $1, 'planet', 'x')", [adaId])).rejects.toThrow(/check constraint/);
    await expect(app.db.query("insert into knowledge.wiki_watch (project_id, user_id, scope_kind, target) values ('shop', $1, 'page', '')", [adaId])).rejects.toThrow(/check constraint/);
  });

  it("watches a page by its path while the Brain is not built, and cannot say whether a folder or a space exists", async () => {
    const early = await watch(ada, "page", LOOSE);
    expect(early.status).toBe(200);
    expect(early.body.data).toMatchObject({ scopeKind: "page", target: `path:${LOOSE}`, path: LOOSE });
    expect((await watch(ada, "folder", "20-spaces/eng")).status).toBe(409);
    expect((await watch(ada, "space", "ENG")).status).toBe(409);
    expect((await unwatch(ada, "page", LOOSE)).status).toBe(204);
    expect(await rows()).toEqual([]);
  });

  it("watches a page by its id when it has one, and a second time changes nothing", async () => {
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true } })).status).toBe(200);
    expect(await build()).toMatchObject({ status: "built" });
    const first = await watch(ada, "page", GUIDE);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ scopeKind: "page", target: "PAGE-ENG-0001", path: GUIDE, title: "Guide" });
    const again = await watch(ada, "page", "PAGE-ENG-0001");
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ target: "PAGE-ENG-0001", createdAt: first.body.data!.createdAt });
    expect((await watch(ada, "page", `path:${GUIDE}`)).body.data?.target).toBe("PAGE-ENG-0001");
    expect(await rows()).toEqual(["page:PAGE-ENG-0001"]);
    // A page without an id is watched by its path.
    expect((await watch(ada, "page", DB)).body.data).toMatchObject({ target: `path:${DB}`, path: DB, title: "Database" });
    expect((await list(ada)).map((entry) => entry.target).sort()).toEqual(["PAGE-ENG-0001", `path:${DB}`]);
  });

  it("says how a page is watched: itself, the nearest folder above it, or its space", async () => {
    expect(await of(ada, GUIDE)).toEqual({ path: GUIDE, watched: true, direct: true, via: null });
    expect(await of(ada, LOOSE)).toEqual({ path: LOOSE, watched: false, direct: false, via: null });
    expect((await watch(ada, "folder", "20-spaces/eng/")).body.data).toMatchObject({ scopeKind: "folder", target: "20-spaces/eng", path: "20-spaces/eng" });
    expect((await watch(ada, "folder", "/20-spaces/eng/runbooks")).body.data?.target).toBe("20-spaces/eng/runbooks");
    // The page watched itself wins; a page only in folders names the nearest one.
    expect((await of(ada, GUIDE)).direct).toBe(true);
    expect(await of(ada, "20-spaces/eng/runbooks/other.md")).toMatchObject({ watched: true, direct: false, via: { scopeKind: "folder", target: "20-spaces/eng/runbooks" } });
    expect(await of(ada, "20-spaces/eng/notes.md")).toMatchObject({ watched: true, direct: false, via: { scopeKind: "folder", target: "20-spaces/eng" } });
    // A space is the last resort, in any letter case.
    expect((await unwatch(ada, "folder", "20-spaces/eng")).status).toBe(204);
    expect((await unwatch(ada, "folder", "20-spaces/eng/runbooks")).status).toBe(204);
    expect((await watch(ada, "space", "eng")).body.data).toMatchObject({ scopeKind: "space", target: "ENG" });
    expect(await of(ada, HOME)).toMatchObject({ watched: true, direct: false, via: { scopeKind: "space", target: "ENG" } });
    expect((await of(ada, DB)).direct).toBe(true);
    expect((await of(ada, LOOSE)).watched).toBe(false);
  });

  it("refuses a folder or a space the Brain does not know, and what is not a page, a folder or a key, with a 400", async () => {
    for (const [scopeKind, target] of [
      ["folder", "20-spaces/nothing"],
      ["folder", GUIDE],
      ["folder", ""],
      ["folder", "/"],
      ["folder", "a/../b"],
      ["space", "NOPE"],
      ["space", "not a key"],
      ["page", "10-eng/missing"],
      ["page", "restricted/secret.md"],
      ["page", "PAGE-ENG-9999"],
      ["planet", "x"],
    ] as const) {
      expect((await watch(ada, scopeKind, target)).status, `${scopeKind} ${target}`).toBe(400);
    }
    expect((await ada.request("PUT", "/projects/shop/wiki/watches", { body: { scopeKind: "page", target: LOOSE, extra: 1 } })).status).toBe(400);
  });

  it("stops watching by path or by id, 404 when it was not watched, and never touches another person's", async () => {
    expect((await watch(grace, "page", GUIDE)).status).toBe(200);
    expect(await list(grace)).toHaveLength(1);
    expect((await unwatch(ada, "page", "PAGE-ENG-0001")).status).toBe(204);
    expect((await unwatch(ada, "page", GUIDE)).status).toBe(404);
    expect((await unwatch(ada, "page", DB)).status).toBe(204);
    expect((await unwatch(ada, "space", "ENG")).status).toBe(204);
    expect(await list(ada)).toEqual([]);
    expect(await list(grace)).toHaveLength(1);
    expect((await of(ada, GUIDE)).watched).toBe(false);
    expect((await of(grace, GUIDE)).watched).toBe(true);
    expect((await unwatch(grace, "page", GUIDE)).status).toBe(204);
  });

  it("keeps the watch of a page that is moved: it is the id that is watched", async () => {
    expect((await watch(ada, "page", GUIDE)).status).toBe(200);
    git("mv", GUIDE, "20-spaces/eng/handbook.md");
    git("commit", "-q", "-m", "rename the guide");
    execFileSync("git", ["--git-dir", mirror, "fetch", "-q", work, "+refs/heads/main:refs/heads/main"]);
    expect(await build()).toMatchObject({ status: "built" });
    expect(await of(ada, "20-spaces/eng/handbook.md")).toEqual({ path: "20-spaces/eng/handbook.md", watched: true, direct: true, via: null });
    expect((await list(ada))[0]).toMatchObject({ target: "PAGE-ENG-0001", path: "20-spaces/eng/handbook.md" });
    // The old path names no page any more: watched by path it would not be this one.
    expect((await of(ada, GUIDE)).watched).toBe(false);
    expect((await unwatch(ada, "page", "PAGE-ENG-0001")).status).toBe(204);
  });

  it("needs Project Access, administrators included, and no other permission", async () => {
    const { client: outsider } = await memberClient(app, admin, "outsider", ["user"], []);
    await app.db.query("delete from admin.project_access where project_id = 'shop' and user_id = $1", [await currentUserId(admin)]);
    for (const client of [outsider, admin]) {
      expect((await client.get("/projects/shop/wiki/watches")).status).toBe(403);
      expect((await client.get(`/projects/shop/wiki/watches?path=${GUIDE}`)).status).toBe(403);
      expect((await watch(client, "page", GUIDE)).status).toBe(403);
      expect((await unwatch(client, "page", GUIDE)).status).toBe(403);
    }
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
    // Someone who only reads (no wiki.write) may watch.
    expect((await watch(ada, "page", LOOSE)).status).toBe(200);
    expect((await unwatch(ada, "page", LOOSE)).status).toBe(204);
  });

  it("allows 500 watches a person and project, and answers the next with a 409; a watch already held is still fine", async () => {
    await app.db.query("delete from knowledge.wiki_watch");
    await app.db.query("insert into knowledge.wiki_watch (project_id, user_id, scope_kind, target) select 'shop', $1, 'page', 'path:30-misc/p' || g || '.md' from generate_series(1, 499) g", [adaId]);
    expect((await watch(ada, "page", LOOSE)).status).toBe(200);
    expect((await list(ada)).length).toBe(500);
    const over = await watch(ada, "page", DB);
    expect(over.status).toBe(409);
    expect(over.body.message).toContain("500");
    expect((await watch(ada, "page", LOOSE)).status).toBe(200);
    // The limit is per person: Grace is not at hers.
    expect((await watch(grace, "page", DB)).status).toBe(200);
    expect((await unwatch(ada, "page", LOOSE)).status).toBe(204);
    expect((await watch(ada, "page", DB)).status).toBe(200);
    // Two requests for the last place do not both pass.
    await unwatch(ada, "page", DB);
    const results = await Promise.all([watch(ada, "folder", "20-spaces/eng"), watch(ada, "folder", "20-spaces/eng/runbooks")]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await list(ada)).length).toBe(500);
    expect((await watch(ada, "space", "ENG")).status).toBe(409);
  });
});
