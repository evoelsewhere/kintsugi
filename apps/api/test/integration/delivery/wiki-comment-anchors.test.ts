// Comments placed again when a page is read (P3-003, exit 1 of Phase 3): a passage that is still in the page is found
// at its new line, one that moved under another heading says so, one that is gone is orphaned and keeps its quote. The
// document repo is a real mirror with commits, and the Brain is built by the worker's own function after each.

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

interface View {
  id: string;
  body: string;
  node: string | null;
  status: string;
  line: number | null;
  quote: string | null;
}
interface List {
  page: { key: string; path: string };
  comments: View[];
}

const GUIDE = "20-spaces/eng/guide.md";
const LOOSE = "30-misc/loose.md";
const HEAD = "---\nid: PAGE-ENG-0001\ntitle: Guide\n---\n\n";
const SETUP = "Install the package first, then run the [setup script](setup.md) twice.";
const USAGE = "Call the service with a token.";
const LATER = "Remove this passage later on.";
const text = (parts: { intro?: string; setup?: string[]; usage?: string[] }): string =>
  `${HEAD}${parts.intro ?? "Introduction."}\n\n## Setup\n\n${(parts.setup ?? [SETUP, LATER]).join("\n\n")}\n\n## Usage\n\n${(parts.usage ?? [USAGE]).join("\n\n")}\n`;
const lineOf = (source: string, needle: string): number => source.split("\n").findIndex((line) => line.includes(needle)) + 1;

describe.skipIf(!hasDatabase)("wiki comments placed again (integration)", () => {
  let app: TestApp;
  let dataDir: string;
  let work: string;
  let mirror: string;
  let pool: pg.Pool;
  let ada: Client;
  let reader: Client;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const git = (...args: string[]): string => execFileSync("git", args, { cwd: work, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } }).trim();
  const build = () => indexBrain({ pool, repositories: new RepositoryStore(pool), storage: new CheckoutStorage(dataDir), log: () => undefined }, "shop");
  /** A new commit of the page in the work repository, fetched into the mirror, and the Brain built at it. */
  const commit = async (path: string, content: string, message: string): Promise<void> => {
    await mkdir(dirname(join(work, path)), { recursive: true });
    await writeFile(join(work, path), content);
    git("add", path);
    git("commit", "-q", "-m", message);
    execFileSync("git", ["--git-dir", mirror, "fetch", "-q", work, "+refs/heads/main:refs/heads/main"]);
  };
  const post = (path: string, body: string, anchor?: Record<string, unknown>) => ada.request<View>("POST", "/projects/shop/wiki/comments", { body: { path, body, ...(anchor === undefined ? {} : { anchor }) } });
  const placed = async (path = GUIDE): Promise<Map<string, View>> => new Map(((await reader.get<List>(`/projects/shop/wiki/comments?path=${encodeURIComponent(path)}`)).body.data!.comments).map((comment) => [comment.body, comment]));

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-anchors-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    work = join(dataDir, "work");
    await mkdir(work);
    git("init", "-q", "-b", "main");
    for (const [path, content] of [
      [GUIDE, text({})],
      [LOOSE, "# Loose\n\nNobody gave this page an id, so it is found by its path.\n"],
    ] as const) {
      await mkdir(dirname(join(work, path)), { recursive: true });
      await writeFile(join(work, path), content);
      git("add", path);
    }
    git("commit", "-q", "-m", "start");
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    mirror = new CheckoutStorage(dataDir).mirror("local", "docs");
    execFileSync("git", ["clone", "-q", "--bare", work, mirror]);

    app = await startTestApp();
    pool = new pg.Pool({ connectionString: app.db.url, max: 2 });
    const admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
    await subRole(admin, "wiki-commenter", ["wiki.comment"]);
    ({ client: ada } = await memberClient(app, admin, "ada", ["user", "wiki-commenter"], ["shop"]));
    ({ client: reader } = await memberClient(app, admin, "reader-r", ["user"], ["shop"]));
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true } })).status).toBe(200);
    expect(await build()).toMatchObject({ status: "built" });
  }, 180_000);
  afterAll(async () => {
    await pool?.end();
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("places a comment at the line of its passage in the page as indexed, under the heading it was written under", async () => {
    expect((await post(GUIDE, "setup question", { node: "setup", exact: "Install the package first, then run the setup script twice." })).status).toBe(201);
    expect((await post(GUIDE, "usage question", { node: "usage", exact: USAGE })).status).toBe(201);
    expect((await post(GUIDE, "removable", { node: "setup", exact: LATER })).status).toBe(201);
    expect((await post(GUIDE, "whole page")).status).toBe(201);
    const now = await placed();
    const source = text({});
    expect(now.get("setup question")).toMatchObject({ status: "anchored", node: "setup", line: lineOf(source, "Install the package"), quote: "Install the package first, then run the setup script twice." });
    expect(now.get("usage question")).toMatchObject({ status: "anchored", node: "usage", line: lineOf(source, USAGE) });
    expect(now.get("removable")).toMatchObject({ status: "anchored", node: "setup", line: lineOf(source, LATER) });
    // A comment on the whole page is anchored at no line, always.
    expect(now.get("whole page")).toMatchObject({ status: "anchored", node: null, line: null, quote: null });
  });

  it("finds the passage again after the page is edited around it, at its new line", async () => {
    const edited = text({ intro: "Introduction, now longer.\n\nA new paragraph above everything else.\n\nAnd one more.", setup: ["A sentence added before the passage.", SETUP, LATER] });
    await commit(GUIDE, edited, "edit around");
    // The Brain has not been built at the new commit yet: the answer is still about the page as indexed.
    expect((await placed()).get("setup question")?.line).toBe(lineOf(text({}), "Install the package"));
    expect(await build()).toMatchObject({ status: "built" });
    const now = await placed();
    expect(now.get("setup question")).toMatchObject({ status: "anchored", node: "setup", line: lineOf(edited, "Install the package") });
    expect(now.get("setup question")!.line).toBeGreaterThan(lineOf(text({}), "Install the package"));
    expect(now.get("usage question")).toMatchObject({ status: "anchored", node: "usage", line: lineOf(edited, USAGE) });
    expect(now.get("removable")).toMatchObject({ status: "anchored" });
  });

  it("says moved, under the new heading, when the passage is now elsewhere in the page", async () => {
    const moved = text({ intro: "Introduction, now longer.\n\nA new paragraph above everything else.\n\nAnd one more.", setup: ["A sentence added before the passage.", LATER], usage: [USAGE, SETUP] });
    await commit(GUIDE, moved, "move the passage");
    expect(await build()).toMatchObject({ status: "built" });
    const now = await placed();
    expect(now.get("setup question")).toMatchObject({ status: "moved", node: "usage", line: lineOf(moved, "Install the package") });
    expect(now.get("usage question")).toMatchObject({ status: "anchored", node: "usage" });
    expect(now.get("removable")).toMatchObject({ status: "anchored", node: "setup" });
  });

  it("says orphaned, with the quote, when the passage is gone, and keeps the comment", async () => {
    const gone = text({ intro: "Introduction, now longer.\n\nA new paragraph above everything else.\n\nAnd one more.", setup: ["A sentence added before the passage."], usage: [USAGE] });
    await commit(GUIDE, gone, "delete passages");
    expect(await build()).toMatchObject({ status: "built" });
    const all = (await reader.get<List>(`/projects/shop/wiki/comments?path=${GUIDE}`)).body.data!.comments;
    expect(all.map((comment) => comment.body)).toEqual(["setup question", "usage question", "removable", "whole page"]);
    const now = await placed();
    expect(now.get("setup question")).toMatchObject({ status: "orphaned", line: null, quote: "Install the package first, then run the setup script twice.", node: "setup" });
    expect(now.get("removable")).toMatchObject({ status: "orphaned", line: null, quote: LATER });
    expect(now.get("usage question")).toMatchObject({ status: "anchored", line: lineOf(gone, USAGE) });
    expect(now.get("whole page")).toMatchObject({ status: "anchored", line: null });
  });

  it("places a passage written before the first heading, and finds a page without an id by its path", async () => {
    const intro = "Introduction, now longer.";
    expect((await post(GUIDE, "intro question", { node: GUIDE, exact: "A new paragraph above everything else." })).status).toBe(201);
    expect((await post(LOOSE, "loose question", { node: LOOSE, exact: "so it is found by its path" })).status).toBe(201);
    expect((await placed()).get("intro question")).toMatchObject({ status: "anchored", node: GUIDE, line: lineOf(text({ intro: `${intro}\n\nA new paragraph above everything else.\n\nAnd one more.` }), "A new paragraph") });
    const loose = (await reader.get<List>(`/projects/shop/wiki/comments?path=${LOOSE}`)).body.data!;
    expect(loose.page.key).toBe(`path:${LOOSE}`);
    expect(loose.comments.map((comment) => comment.body)).toEqual(["loose question"]);
    expect(loose.comments[0]).toMatchObject({ status: "anchored", line: 3 });
  });

  it("keeps the comments of a page that was moved, under its id, and lists none for a page that is gone", async () => {
    const before = (await placed()).size;
    git("mv", GUIDE, "20-spaces/eng/handbook.md");
    git("commit", "-q", "-m", "rename the guide");
    execFileSync("git", ["--git-dir", mirror, "fetch", "-q", work, "+refs/heads/main:refs/heads/main"]);
    expect(await build()).toMatchObject({ status: "built" });
    const renamed = (await reader.get<List>("/projects/shop/wiki/comments?path=20-spaces/eng/handbook.md")).body.data!;
    expect(renamed.page.key).toBe("PAGE-ENG-0001");
    expect(renamed.comments).toHaveLength(before);
    // The old path names no page any more: 404, not an empty list.
    expect((await reader.get(`/projects/shop/wiki/comments?path=${GUIDE}`)).status).toBe(404);
    git("rm", "-q", "20-spaces/eng/handbook.md");
    git("commit", "-q", "-m", "delete the page");
    execFileSync("git", ["--git-dir", mirror, "fetch", "-q", work, "+refs/heads/main:refs/heads/main"]);
    expect(await build()).toMatchObject({ status: "built" });
    expect((await reader.get("/projects/shop/wiki/comments?path=20-spaces/eng/handbook.md")).status).toBe(404);
    // The rows are still there, for the day the page is back.
    expect((await app.db.query("select 1 from knowledge.wiki_comment where page_key = 'PAGE-ENG-0001'")).rowCount).toBeGreaterThan(0);
  });
});
