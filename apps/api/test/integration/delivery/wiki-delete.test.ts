// Deleting a page (ADR-0098, design-wiki-pages section 5): one write with a delete entry that expects the page as it is,
// the page's name taken out of its folder's order list, the links into it counted from the Brain beforehand and reported
// as broken links after the Brain builds. The document repo is a real bare mirror; the worker's outcome is recorded by
// the test, and the Brain is built by the worker's own function.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BrainBrokenView } from "@kintsugi/domain";
import { CheckoutStorage } from "@kintsugi/git";
import { RepositoryStore } from "@kintsugi/orchestrator";
import { indexBrain } from "@kintsugi/orchestrator/brain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WikiDirectPublish } from "#modules/delivery/wiki/index.js";
import { type Client, adminClient, currentUserId, grantProjectAccess, memberClient, startTestApp, subRole, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Deleted {
  outcome: string;
  write: { id: string; status: string; mode: string };
  brokenLinks: number;
}
interface Payload {
  directPublish?: boolean;
  page: { id: string | null; path: string; minor: boolean };
  files: Array<{ path: string; content: string; delete?: boolean; expectedHash?: string }>;
}

const sha256 = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const README = "---\nkey: ENG\norder:\n  - guide\n  - other\n---\n\n# Engineering\n";
const GUIDE = "---\nid: PAGE-ENG-0001\n---\n\n# Guide\n\nSetup steps.\n";
const OTHER = "# Other\n\nSee [the guide](guide.md) first.\n";
const POLICY = "# Policy\n\nEngineering's [guide](../10-eng/guide.md#guide) applies.\n";
const LONELY = "# Lonely\n\nNobody links here.\n";

describe.skipIf(!hasDatabase)("wiki delete (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let work: string;
  let mirror: string;
  let pool: pg.Pool;
  let editor: Client;
  let publisher: Client;
  let reader: Client;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const git = (...args: string[]): string => execFileSync("git", args, { cwd: work, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } }).trim();
  const put = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(work, path)), { recursive: true });
    await writeFile(join(work, path), text);
    git("add", path);
  };
  const advanceMirror = (): void => {
    execFileSync("git", ["--git-dir", mirror, "fetch", "-q", work, "+refs/heads/main:refs/heads/main"]);
  };
  const remove = (client: Client, body: Record<string, unknown>) => client.request<Deleted>("POST", "/projects/shop/wiki/delete", { body: { message: "Remove the page", ...body } });
  const payload = async (writeId: string): Promise<Payload> => (await app.db.query<{ data: Payload }>("select data from pgboss.job where name = 'document-write' and data->>'writeId' = $1", [writeId])).rows[0]!.data;
  const audit = async (action: string) => (await app.db.query<{ detail: Record<string, unknown> }>("select detail from governance.audit_event where action = $1 order by id", [action])).rows.map((row) => row.detail);
  const build = () => indexBrain({ pool, repositories: new RepositoryStore(pool), storage: new CheckoutStorage(dataDir), log: () => undefined }, "shop");
  const close = (writeId: string) => app.db.query("update workflow.document_write set status = 'closed' where id = $1", [writeId]);

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-delete-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    work = join(dataDir, "work");
    await mkdir(work);
    git("init", "-q", "-b", "main");
    await put("10-eng/README.md", README);
    await put("10-eng/guide.md", GUIDE);
    await put("10-eng/other.md", OTHER);
    await put("20-hr/policy.md", POLICY);
    await put("30-misc/lonely.md", LONELY);
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
    await subRole(admin, "wiki-editor", ["wiki.write"]);
    await subRole(admin, "wiki-publisher", ["wiki.write", "wiki.publish"]);
    ({ client: editor } = await memberClient(app, admin, "editor-a", ["user", "wiki-editor"], ["shop"]));
    ({ client: publisher } = await memberClient(app, admin, "publisher-p", ["user", "wiki-publisher"], ["shop"]));
    ({ client: reader } = await memberClient(app, admin, "reader-r", ["user"], ["shop"]));
  }, 180_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    await pool?.end();
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("deletes a page that has no home page and no index to count from: one entry, no broken links known", async () => {
    const done = await remove(editor, { path: "30-misc/lonely.md" });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ outcome: "published", brokenLinks: 0, write: { status: "queued", mode: "pull-request" } });
    expect(await payload(done.body.data!.write.id)).toMatchObject({ page: { id: null, path: "30-misc/lonely.md", minor: false }, files: [{ path: "30-misc/lonely.md", content: "", delete: true, expectedHash: sha256(LONELY) }] });
    // The page has a write open, so a second delete of it is refused naming that write.
    const second = await remove(editor, { path: "30-misc/lonely.md" });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ details: { code: "open-write", write: { id: done.body.data!.write.id, author: "editor-a" } } });
    await close(done.body.data!.write.id);
  });

  it("refuses what is not a page, a person without the right (audited), a restriction, and a page that is not there", async () => {
    const before = (await app.db.query<{ n: number }>("select count(*)::int as n from workflow.document_write")).rows[0]!.n;
    expect((await remove(editor, { path: "restricted/secret.md" })).status).toBe(400);
    expect((await remove(editor, { path: "10-eng/_attachments/figure.png" })).status).toBe(400);
    expect((await remove(editor, { path: "10-eng/nothing.md" })).status).toBe(404);
    expect((await remove(editor, { path: "10-eng/guide.md", extra: true })).status).toBe(400);
    expect((await remove(editor, { path: "10-eng/guide.md", message: "" })).status).toBe(400);
    const refused = await remove(reader, { path: "10-eng/guide.md" });
    expect(refused.status).toBe(403);
    expect((await audit("wiki-page.refused")).at(-1)).toMatchObject({ path: "10-eng/guide.md", code: "permission", operation: "publish", username: "reader-r" });
    await subRole(admin, "wiki-manager", ["wiki.manage"]);
    const manager = await memberClient(app, admin, "manager-m", ["user", "wiki-manager"], ["shop"]);
    expect((await manager.client.request("PUT", "/projects/shop/wiki/restrictions", { body: { pathPrefix: "10-eng/other.md", kind: "edit", subjects: [{ kind: "user", id: manager.id }] } })).status).toBe(200);
    const restricted = await remove(editor, { path: "10-eng/other.md" });
    expect(restricted.status).toBe(403);
    expect(restricted.body).toMatchObject({ details: { refusal: { code: "restriction", pathPrefix: "10-eng/other.md" } } });
    await manager.client.request("DELETE", "/projects/shop/wiki/restrictions?pathPrefix=10-eng%2Fother.md&kind=edit");
    expect((await app.db.query<{ n: number }>("select count(*)::int as n from workflow.document_write")).rows[0]!.n).toBe(before);
  });

  it("removes the page and its name from the folder's order list in one write, counts the links into it, and the report lists them once the Brain builds", async () => {
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true } })).status).toBe(200);
    expect(await build()).toMatchObject({ status: "built" });
    const done = await remove(editor, { path: "10-eng/guide.md", message: "Remove the guide\n\nIt moved to the handbook." });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ outcome: "published", brokenLinks: 2, write: { mode: "pull-request" } });
    const writeId = done.body.data!.write.id;
    const data = await payload(writeId);
    expect(data.page).toEqual({ id: "PAGE-ENG-0001", path: "10-eng/guide.md", minor: false });
    expect(data).not.toHaveProperty("directPublish");
    expect(data.files).toEqual([
      { path: "10-eng/guide.md", content: "", delete: true, expectedHash: sha256(GUIDE) },
      { path: "10-eng/README.md", content: README.replace("  - guide\n", ""), expectedHash: sha256(README) },
    ]);
    expect((await audit("wiki-page.delete")).slice(-1)).toEqual([{ path: "10-eng/guide.md", mode: "pull-request", writeId, pageId: "PAGE-ENG-0001", brokenLinks: 2, username: "editor-a" }]);

    // The write lands: the file is gone and the home page's list no longer names it.
    git("rm", "-q", "10-eng/guide.md");
    await put("10-eng/README.md", README.replace("  - guide\n", ""));
    git("commit", "-q", "-m", "delete guide");
    advanceMirror();
    await app.db.query("update workflow.document_write set status = 'merged', branch = 'kintsugi/x' where id = $1", [writeId]);
    expect(await build()).toMatchObject({ status: "built" });
    const broken = (await admin.get<BrainBrokenView>("/projects/shop/brain/broken")).body.data!;
    const into = broken.links.filter((link) => /guide\.md/.test(JSON.stringify(link)));
    expect(into).toHaveLength(2);
    expect(JSON.stringify(into)).toContain("10-eng/other.md");
    expect(JSON.stringify(into)).toContain("20-hr/policy.md");
  });

  it("leaves the order list alone when the page is not in it, and refuses while the home page has a write open", async () => {
    // other.md is still in the order list: deleting it while someone has a write open on the home page is refused.
    await app.db.query("insert into workflow.document_write (id, project_id, kind, status, message, actor, branch, pr_url, page_path) values ('home-open', 'shop', 'page', 'pr-opened', 'm', 'grace', 'kintsugi/grace/home', 'https://git.example.invalid/pull/4', '10-eng/README.md')");
    const blocked = await remove(editor, { path: "10-eng/other.md" });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ details: { code: "open-write", write: { id: "home-open", author: "grace", prUrl: "https://git.example.invalid/pull/4" } } });
    await close("home-open");
    // Not in the list: only the delete entry.
    await put("10-eng/README.md", README.replace("  - guide\n", "").replace("  - other\n", ""));
    git("commit", "-q", "-m", "empty order");
    advanceMirror();
    const done = await remove(editor, { path: "10-eng/other.md" });
    expect((await payload(done.body.data!.write.id)).files).toEqual([{ path: "10-eng/other.md", content: "", delete: true, expectedHash: sha256(OTHER) }]);
    await close(done.body.data!.write.id);
  });

  it("goes straight to the default branch only when every path it touches allows it, for a person with wiki.publish", async () => {
    await put("10-eng/direct-a.md", "# A\n");
    await put("10-eng/direct-b.md", "# B\n");
    git("commit", "-q", "-m", "two pages");
    advanceMirror();
    const globs = vi.spyOn(app.nest.get(WikiDirectPublish, { strict: false }), "globs").mockResolvedValue(["10-eng/**"]);
    const direct = await remove(publisher, { path: "10-eng/direct-a.md" });
    expect(direct.body.data).toMatchObject({ write: { mode: "direct" } });
    expect(await payload(direct.body.data!.write.id)).toMatchObject({ directPublish: true });
    // The same person without the globs, and a person without wiki.publish, go through a pull request.
    globs.mockResolvedValue(["20-hr/**"]);
    const viaPullRequest = await remove(publisher, { path: "10-eng/direct-b.md" });
    expect(viaPullRequest.body.data).toMatchObject({ write: { mode: "pull-request" } });
    expect(await payload(viaPullRequest.body.data!.write.id)).not.toHaveProperty("directPublish");
    globs.mockResolvedValue(["10-eng/**"]);
    await close(direct.body.data!.write.id);
    const byEditor = await remove(editor, { path: "10-eng/direct-a.md" });
    expect(byEditor.body.data).toMatchObject({ write: { mode: "pull-request" } });
    vi.restoreAllMocks();
  });
});
