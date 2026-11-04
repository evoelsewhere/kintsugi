// Drafts of wiki pages (ADR-0098 decision 2, design-wiki-draft-publish section 2): autosave creates and updates a
// draft in Postgres on a real document mirror, whose base is the commit the text was read from, never the head;
// presence shows who else is on the page; a draft belongs to its author and goes when its write has landed.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Draft {
  path: string;
  pageId: string | null;
  text: string;
  revision: number;
  baseCommit: string | null;
  baseHash: string | null;
  touchedAt: string;
  writeId: string | null;
  others: Array<{ userId: string; name: string; touchedAt: string }>;
}

const sha256 = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const GUIDE_V1 = "---\ntitle: Guide\n---\n\n# Guide\n\nFirst version.\n";
const GUIDE_V2 = "---\ntitle: Guide\n---\n\n# Guide\n\nSecond version, newer than what the editor read.\n";
const PAGE = "10-wiki/guide.md";

describe.skipIf(!hasDatabase)("wiki drafts (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let work: string;
  let editor: Client;
  let editorId: string;
  let second: Client;
  let secondId: string;
  const shas: Record<string, string> = {};
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const git = (...args: string[]): string => execFileSync("git", args, { cwd: work, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } }).trim();
  const commit = async (name: string, files: Record<string, string>): Promise<void> => {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(work, path)), { recursive: true });
      await writeFile(join(work, path), content);
      git("add", path);
    }
    git("commit", "-q", "-m", name);
    shas[name] = git("rev-parse", "HEAD");
  };
  const put = (client: Client, body: Record<string, unknown>) => client.request<Draft>("PUT", "/projects/shop/wiki/draft", { body });
  const get = (client: Client, path: string) => client.get<Draft>(`/projects/shop/wiki/draft?path=${encodeURIComponent(path)}`);
  const discard = (client: Client, path: string) => client.request("DELETE", `/projects/shop/wiki/draft?path=${encodeURIComponent(path)}`);
  const clear = async (): Promise<void> => {
    await app.db.query("delete from knowledge.wiki_draft");
  };

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-drafts-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    work = join(dataDir, "work");
    await mkdir(work);
    git("init", "-q", "-b", "main");
    await commit("v1", { [PAGE]: GUIDE_V1, "10-wiki/other.md": "# Other\n" });
    await commit("v2", { [PAGE]: GUIDE_V2 });
    git("checkout", "-q", "-b", "feature");
    await commit("on-feature", { "10-wiki/feature.md": "# Feature\n" });
    git("checkout", "-q", "main");
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    execFileSync("git", ["clone", "-q", "--bare", work, new CheckoutStorage(dataDir).mirror("local", "docs")]);

    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await subRole(admin, "wiki-editor", ["wiki.write"]);
    ({ client: editor, id: editorId } = await memberClient(app, admin, "editor-a", ["user", "wiki-editor"], ["shop"]));
    ({ client: second, id: secondId } = await memberClient(app, admin, "editor-b", ["user", "wiki-editor"], ["shop"]));
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("creates a draft at revision 1 whose base is the commit the text was read from, not the head", async () => {
    // The editor read the page at v1; the head is already v2.
    const created = await put(editor, { path: PAGE, text: `${GUIDE_V1}\nEdited.\n`, baseRevision: null, baseCommit: shas["v1"] });
    expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({ path: PAGE, text: `${GUIDE_V1}\nEdited.\n`, revision: 1, baseCommit: shas["v1"], baseHash: sha256(GUIDE_V1), writeId: null, others: [] });
    expect(created.body.data!.baseHash).not.toBe(sha256(GUIDE_V2));
    expect((await get(editor, PAGE)).body.data).toMatchObject({ revision: 1, baseCommit: shas["v1"], baseHash: sha256(GUIDE_V1) });
  });

  it("updates by revision, and a stale revision is a 409 draft-revision with the stored one", async () => {
    const updated = await put(editor, { path: PAGE, text: "# Guide\n\nTwo.\n", baseRevision: 1 });
    expect(updated.body.data).toMatchObject({ revision: 2, text: "# Guide\n\nTwo.\n", baseCommit: shas["v1"], baseHash: sha256(GUIDE_V1) });
    const stale = await put(editor, { path: PAGE, text: "from another tab", baseRevision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ success: false, statusCode: 409, details: { code: "draft-revision", revision: 2 } });
    expect((await get(editor, PAGE)).body.data?.text).toBe("# Guide\n\nTwo.\n");
    // A first save over an existing draft (baseRevision null) is the same conflict; a revision for no draft says 0.
    expect((await put(editor, { path: PAGE, text: "x", baseRevision: null, baseCommit: shas["v1"] })).body).toMatchObject({ details: { code: "draft-revision", revision: 2 } });
    expect((await put(editor, { path: "10-wiki/other.md", text: "x", baseRevision: 3 })).body).toMatchObject({ statusCode: 409, details: { code: "draft-revision", revision: 0 } });
    // Saving the same text again keeps the draft as it is and raises the revision.
    expect((await put(editor, { path: PAGE, text: "# Guide\n\nTwo.\n", baseRevision: 2 })).body.data?.revision).toBe(3);
  });

  it("refuses a first save whose base is missing, unknown or off the default branch, and a path or text that cannot be", async () => {
    await clear();
    const text = "# Guide\n";
    // Without baseCommit only a page that does not exist yet can be drafted.
    const noBase = await put(editor, { path: PAGE, text, baseRevision: null });
    expect(noBase.status).toBe(400);
    expect(noBase.body.message).toContain("baseCommit");
    const unknown = await put(editor, { path: PAGE, text, baseRevision: null, baseCommit: "f".repeat(40) });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toContain("not a commit");
    const offBranch = await put(editor, { path: PAGE, text, baseRevision: null, baseCommit: shas["on-feature"] });
    expect(offBranch.status).toBe(400);
    expect(offBranch.body.message).toContain("history of the default branch");
    expect((await put(editor, { path: PAGE, text, baseRevision: null, baseCommit: "not-a-commit" })).status).toBe(400);
    for (const path of ["restricted/secret.md", "_generated/out.md", "plugins/x/README.md", "10-wiki/guide.txt", "../outside.md", "10-wiki/_attachments/a.png", ".hidden/page.md"]) {
      expect((await put(editor, { path, text, baseRevision: null })).status, path).toBe(400);
    }
    expect((await put(editor, { path: PAGE, text, baseRevision: 0, baseCommit: shas["v1"] })).status).toBe(400);
    expect((await put(editor, { path: PAGE, text, baseRevision: null, extra: true })).status).toBe(400);
    expect((await app.db.query("select 1 from knowledge.wiki_draft")).rowCount).toBe(0);
  });

  it("creates the draft of a page that does not exist yet with no base, and a base older than the page's birth has no hash", async () => {
    const fresh = await put(editor, { path: "10-wiki/new-page.md", text: "# New\n", baseRevision: null });
    expect(fresh.body.data).toMatchObject({ revision: 1, baseCommit: null, baseHash: null });
    // The page did not exist at v1 (other.md did, guide.md did, new-page.md never): a base is allowed and hashes to nothing.
    const based = await put(editor, { path: "10-wiki/new-too.md", text: "# New\n", baseRevision: null, baseCommit: shas["v1"] });
    expect(based.body.data).toMatchObject({ baseCommit: shas["v1"], baseHash: null });
  });

  it("shows only the caller's draft, and who else touched the page in the last two minutes, never their text", async () => {
    await clear();
    await put(editor, { path: PAGE, text: "editor a's secret text", baseRevision: null, baseCommit: shas["v2"] });
    expect((await get(second, PAGE)).status).toBe(404);
    const theirs = await put(second, { path: PAGE, text: "editor b writes", baseRevision: null, baseCommit: shas["v2"] });
    expect(theirs.body.data?.others).toEqual([{ userId: editorId, name: "editor-a", touchedAt: expect.any(String) }]);
    expect(JSON.stringify(theirs.body)).not.toContain("secret text");
    expect((await get(editor, PAGE)).body.data?.others).toEqual([{ userId: secondId, name: "editor-b", touchedAt: expect.any(String) }]);
    // Touched more than two minutes ago: gone from the presence. No longer holding Project Access: gone too.
    await app.db.query("update knowledge.wiki_draft set touched_at = now() - interval '121 seconds' where user_id = $1", [secondId]);
    expect((await get(editor, PAGE)).body.data?.others).toEqual([]);
    await app.db.query("update knowledge.wiki_draft set touched_at = now() where user_id = $1", [secondId]);
    expect((await get(editor, PAGE)).body.data?.others).toHaveLength(1);
    await app.db.query("delete from admin.project_access where user_id = $1", [secondId]);
    expect((await get(editor, PAGE)).body.data?.others).toEqual([]);
    await admin.request("PUT", `/admin/project-access/shop/${secondId}`, { body: {} });
    // A draft of another page is not presence on this one.
    await put(second, { path: "10-wiki/other.md", text: "x", baseRevision: null, baseCommit: shas["v2"] });
    expect((await get(editor, PAGE)).body.data?.others.map((other) => other.userId)).toEqual([secondId]);
  });

  it("lists the caller's drafts and discards one (204, idempotent), leaving the others", async () => {
    const list = (await editor.get<Array<{ path: string; revision: number; writeId: string | null }>>("/projects/shop/wiki/drafts")).body.data!;
    expect(list.map((draft) => draft.path)).toEqual([PAGE]);
    await put(editor, { path: "10-wiki/other.md", text: "mine", baseRevision: null, baseCommit: shas["v2"] });
    expect(((await editor.get<Array<{ path: string }>>("/projects/shop/wiki/drafts")).body.data ?? []).map((draft) => draft.path).sort()).toEqual([PAGE, "10-wiki/other.md"]);
    expect((await discard(editor, PAGE)).status).toBe(204);
    expect((await discard(editor, PAGE)).status).toBe(204);
    expect((await get(editor, PAGE)).status).toBe(404);
    expect((await get(second, "10-wiki/other.md")).status).toBe(200);
    expect((await get(editor, "10-wiki/other.md")).status).toBe(200);
  });

  it("removes a draft whose write landed, keeps one that waits for review, and keeps one whose pull request was closed, without its write", async () => {
    await clear();
    const created = (await put(editor, { path: PAGE, text: "# Guide\n\nPublished.\n", baseRevision: null, baseCommit: shas["v2"] })).body.data!;
    const writeId = "write-for-the-draft";
    await app.db.query("insert into workflow.document_write (id, project_id, kind, status, message, actor) values ($1, 'shop', 'page', 'queued', 'Publish', 'editor-a')", [writeId]);
    const attach = (status: string, branch: string | null) => app.db.query("update workflow.document_write set status = $2, branch = $3 where id = $1", [writeId, status, branch]);
    const link = () => app.db.query("update knowledge.wiki_draft set write_id = $1 where project_id = 'shop' and user_id = $2 and page_path = $3", [writeId, editorId, PAGE]);

    await link();
    for (const [status, branch] of [["queued", null], ["pr-opened", "kintsugi/editor-a/guide"], ["committed", "kintsugi/editor-a/guide"]] as const) {
      await attach(status, branch);
      expect((await get(editor, PAGE)).body.data, status).toMatchObject({ writeId, revision: created.revision });
    }
    // Closed without a merge: the draft stays, the write is let go, so the author can change it and publish again.
    await attach("closed", "kintsugi/editor-a/guide");
    expect((await get(editor, PAGE)).body.data).toMatchObject({ writeId: null, text: "# Guide\n\nPublished.\n" });
    expect((await app.db.query("select write_id from knowledge.wiki_draft")).rows).toEqual([{ write_id: null }]);
    // Landed on the default branch: merged, committed without a review branch, or unchanged: the draft is removed, then 404.
    for (const [status, branch] of [["merged", "kintsugi/editor-a/guide"], ["committed", null], ["unchanged", null]] as const) {
      await link();
      await attach(status, branch);
      expect((await get(editor, PAGE)).status, status).toBe(404);
      expect((await app.db.query("select 1 from knowledge.wiki_draft")).rowCount, status).toBe(0);
      await put(editor, { path: PAGE, text: "# Guide\n\nAgain.\n", baseRevision: null, baseCommit: shas["v2"] });
    }
    // A write that failed or that is gone lets the draft go on without it.
    await link();
    await attach("failed", null);
    expect((await get(editor, PAGE)).body.data?.writeId).toBeNull();
    await link();
    await app.db.query("delete from workflow.document_write where id = $1", [writeId]);
    expect((await get(editor, PAGE)).body.data?.writeId).toBeNull();
  });

  it("clears the write of a draft when its text changes after publishing, and keeps it when the same text is saved again", async () => {
    await clear();
    await put(editor, { path: PAGE, text: "# Guide\n\nSent.\n", baseRevision: null, baseCommit: shas["v2"] });
    await app.db.query("insert into workflow.document_write (id, project_id, kind, status, message, branch) values ('sent-write', 'shop', 'page', 'pr-opened', 'Publish', 'kintsugi/x')");
    await app.db.query("update knowledge.wiki_draft set write_id = 'sent-write'");
    const same = await put(editor, { path: PAGE, text: "# Guide\n\nSent.\n", baseRevision: 1 });
    expect(same.body.data).toMatchObject({ revision: 2, writeId: "sent-write" });
    const changed = await put(editor, { path: PAGE, text: "# Guide\n\nSent, then edited.\n", baseRevision: 2 });
    expect(changed.body.data).toMatchObject({ revision: 3, writeId: null });
    await app.db.query("delete from workflow.document_write where id = 'sent-write'");
  });

  it("needs Project Access and, to write, wiki.write: administrators without a grant are refused, readers read only", async () => {
    await clear();
    const body = { path: PAGE, text: "# Guide\n", baseRevision: null, baseCommit: shas["v2"] };
    // No Project Access: refused everywhere, administrator included.
    const { client: outsider } = await memberClient(app, admin, "wiki-outsider", ["user", "wiki-editor"], []);
    for (const client of [outsider, admin]) {
      expect((await put(client, body)).status).toBe(403);
      expect((await get(client, PAGE)).status).toBe(403);
      expect((await discard(client, PAGE)).status).toBe(403);
      expect((await client.get("/projects/shop/wiki/drafts")).status).toBe(403);
    }
    // Project Access without wiki.write: may look (404, empty list), may not save or discard.
    const { client: reader } = await memberClient(app, admin, "wiki-reader", ["user"], ["shop"]);
    expect((await put(reader, body)).status).toBe(403);
    expect((await put(reader, body)).body.message).toContain("wiki.write");
    expect((await discard(reader, PAGE)).status).toBe(403);
    expect((await get(reader, PAGE)).status).toBe(404);
    expect((await reader.get<unknown[]>("/projects/shop/wiki/drafts")).body.data).toEqual([]);
    expect((await app.db.query("select 1 from knowledge.wiki_draft")).rowCount).toBe(0);
  });

  it("never reaches the document writer: autosave leaves workflow.document_write and the queue untouched", async () => {
    await clear();
    const writesBefore = (await app.db.query("select 1 from workflow.document_write")).rowCount;
    // The queue's tables exist once something was enqueued (here nothing is); count the jobs when they do.
    const jobs = async (): Promise<number> => ((await app.db.query("select to_regclass('pgboss.job') as job")).rows[0]?.job === null ? 0 : ((await app.db.query("select 1 from pgboss.job where name = 'document-write'")).rowCount ?? 0));
    const jobsBefore = await jobs();
    await put(editor, { path: PAGE, text: "# Guide\n\nOne.\n", baseRevision: null, baseCommit: shas["v2"] });
    await put(editor, { path: PAGE, text: "# Guide\n\nTwo.\n", baseRevision: 1 });
    await discard(editor, PAGE);
    expect((await app.db.query("select 1 from workflow.document_write")).rowCount).toBe(writesBefore);
    expect(await jobs()).toBe(jobsBefore);
  });
});
