// Who may write a wiki page (ADR-0099 decisions 5 and 7, roadmap exit 3): the access answer, edit restrictions that only
// narrow, `wiki.manage` to set them, and a refusal at the draft audited. The document repo is a real bare mirror.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, currentUserId, grantProjectAccess, memberClient, startTestApp, subRole, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Access {
  path: string;
  editable: boolean;
  canWrite: boolean;
  canPublish: boolean;
  direct: boolean;
  refusal: { code: string; message: string; pathPrefix?: string } | null;
  pending: { writeId: string; status: string; prUrl: string | null; author: string | null } | null;
}
interface Restriction {
  pathPrefix: string;
  kind: string;
  subjects: Array<{ kind: string; id: string; name: string }>;
}

const GUIDE = "10-wiki/guide.md";
const SIBLING = "10-wiki/other.md";
const FOLDER = "10-wiki/";

describe.skipIf(!hasDatabase)("wiki access and restrictions (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let editor: Client;
  let editorId: string;
  let lead: Client;
  let leadId: string;
  let reader: Client;
  let manager: Client;
  let managerId: string;
  let head: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const access = async (client: Client, path: string) => (await client.get<Access>(`/projects/shop/wiki/access?path=${encodeURIComponent(path)}`)).body.data!;
  const draft = (client: Client, path: string) => client.request("PUT", "/projects/shop/wiki/draft", { body: { path, text: "# Text\n", baseRevision: null, baseCommit: head } });
  const restrict = (client: Client, body: unknown) => client.request<Restriction>("PUT", "/projects/shop/wiki/restrictions", { body });
  const unrestrict = (client: Client, pathPrefix: string, kind = "edit") => client.request("DELETE", `/projects/shop/wiki/restrictions?pathPrefix=${encodeURIComponent(pathPrefix)}&kind=${kind}`);
  const audit = async (action: string) => (await app.db.query<{ actor: string; subject: string | null; detail: Record<string, unknown> }>("select actor, subject, detail from governance.audit_event where action = $1 order by id", [action])).rows;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-access-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    const work = join(dataDir, "work");
    await mkdir(work);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: work, env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } });
    git("init", "-q", "-b", "main");
    for (const path of [GUIDE, SIBLING]) {
      await mkdir(dirname(join(work, path)), { recursive: true });
      await writeFile(join(work, path), `# ${path}\n`);
      git("add", path);
    }
    git("commit", "-q", "-m", "pages");
    head = git("rev-parse", "HEAD").toString().trim();
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    execFileSync("git", ["clone", "-q", "--bare", work, new CheckoutStorage(dataDir).mirror("local", "docs")]);

    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
    await subRole(admin, "wiki-editor", ["wiki.write"]);
    await subRole(admin, "wiki-leads", ["wiki.write"]);
    await subRole(admin, "wiki-manager", ["wiki.manage", "wiki.write"]);
    ({ client: editor, id: editorId } = await memberClient(app, admin, "editor-a", ["user", "wiki-editor"], ["shop"]));
    ({ client: lead, id: leadId } = await memberClient(app, admin, "lead-l", ["user", "wiki-leads"], ["shop"]));
    ({ client: reader } = await memberClient(app, admin, "reader-r", ["user"], ["shop"]));
    ({ client: manager, id: managerId } = await memberClient(app, admin, "manager-m", ["user", "wiki-manager"], ["shop"]));
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("needs Project Access on every route, administrators included", async () => {
    const { client: outsider } = await memberClient(app, admin, "outsider-o", ["user", "wiki-manager"], []);
    const { client: noAccessAdmin } = { client: await adminClient(app) };
    await app.db.query("delete from admin.project_access where project_id = 'shop' and user_id = $1", [await currentUserId(noAccessAdmin)]);
    for (const client of [outsider, noAccessAdmin]) {
      expect((await client.get(`/projects/shop/wiki/access?path=${GUIDE}`)).status).toBe(403);
      expect((await client.get("/projects/shop/wiki/restrictions")).status).toBe(403);
      expect((await restrict(client, { pathPrefix: FOLDER, kind: "edit", subjects: [{ kind: "user", id: editorId }] })).status).toBe(403);
      expect((await unrestrict(client, FOLDER)).status).toBe(403);
    }
    await grantProjectAccess(admin, "shop", await currentUserId(noAccessAdmin));
  });

  it("answers the access of a page: who may write, publish, and why not", async () => {
    expect(await access(editor, GUIDE)).toEqual({ path: GUIDE, editable: true, canWrite: true, canPublish: true, direct: false, refusal: null, pending: null });
    expect(await access(reader, GUIDE)).toMatchObject({ editable: true, canWrite: false, canPublish: false, direct: false, refusal: { code: "permission" } });
    for (const path of ["restricted/secret.md", "_generated/out.md", "kintsugi.yaml", "plugins/x/README.md"]) {
      expect(await access(editor, path), path).toMatchObject({ editable: false, canWrite: false, refusal: { code: "not-editable" } });
    }
  });

  it("shows the write that waits for review on the page", async () => {
    await app.db.query("insert into workflow.document_write (id, project_id, kind, status, message, actor, branch, pr_url, page_path) values ('open-1', 'shop', 'page', 'pr-opened', 'm', 'someone', 'kintsugi/someone/x', 'https://git.example.invalid/pr/7', $1)", [GUIDE]);
    expect((await access(reader, GUIDE)).pending).toEqual({ writeId: "open-1", status: "pr-opened", prUrl: "https://git.example.invalid/pr/7", author: "someone" });
    expect((await access(reader, SIBLING)).pending).toBeNull();
    await app.db.query("update workflow.document_write set status = 'merged' where id = 'open-1'");
    expect((await access(reader, GUIDE)).pending).toBeNull();
  });

  it("refuses a draft by someone without wiki.write, audits it, and does not audit a path that is simply not a page", async () => {
    const refused = await draft(reader, GUIDE);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ details: { refusal: { code: "permission" } } });
    expect(await audit("wiki-page.refused")).toEqual([{ actor: expect.any(String), subject: GUIDE, detail: { path: GUIDE, code: "permission", operation: "draft", username: "reader-r" } }]);
    expect((await draft(reader, "restricted/secret.md")).status).toBe(400);
    expect((await audit("wiki-page.refused")).length).toBe(1);
  });

  it("limits a page to the listed people and roles, for the person with the space right and not for its sibling", async () => {
    const set = await restrict(manager, { pathPrefix: GUIDE, kind: "edit", subjects: [{ kind: "role", id: "wiki-leads" }] });
    expect(set.status).toBe(200);
    expect(set.body.data).toEqual({ pathPrefix: GUIDE, kind: "edit", subjects: [{ kind: "role", id: "wiki-leads", name: "wiki-leads" }] });
    // The editor holds wiki.write and is refused on the page, not on its sibling; the lead holds the role and is not.
    expect(await access(editor, GUIDE)).toMatchObject({ canWrite: false, canPublish: false, direct: false, refusal: { code: "restriction", pathPrefix: GUIDE } });
    expect((await access(editor, SIBLING)).canWrite).toBe(true);
    expect((await access(lead, GUIDE)).canWrite).toBe(true);
    const before = (await audit("wiki-page.refused")).length;
    const refused = await draft(editor, GUIDE);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ details: { refusal: { code: "restriction", pathPrefix: GUIDE } } });
    expect((await audit("wiki-page.refused")).slice(before)).toEqual([{ actor: editorId, subject: GUIDE, detail: { path: GUIDE, code: "restriction", operation: "draft", pathPrefix: GUIDE, username: "editor-a" } }]);
    expect((await draft(editor, SIBLING)).status).toBe(200);
    expect((await draft(lead, GUIDE)).status).toBe(200);
  });

  it("adds a folder's rule to the page's: both must be met, and holding wiki.manage exempts nobody", async () => {
    await restrict(manager, { pathPrefix: FOLDER, kind: "edit", subjects: [{ kind: "user", id: leadId }, { kind: "user", id: managerId }] });
    // The lead meets the folder's rule and the page's; the editor and the reader meet neither; the manager is listed on the folder but not on the page.
    expect((await access(lead, GUIDE)).canWrite).toBe(true);
    expect((await access(manager, GUIDE))).toMatchObject({ canWrite: false, refusal: { code: "restriction", pathPrefix: GUIDE } });
    expect((await access(manager, SIBLING)).canWrite).toBe(true);
    expect((await access(editor, SIBLING))).toMatchObject({ canWrite: false, refusal: { code: "restriction", pathPrefix: FOLDER } });
    // The restriction never widens: removing the folder's rule leaves the page's.
    expect((await unrestrict(manager, FOLDER)).status).toBe(204);
    expect((await access(editor, SIBLING)).canWrite).toBe(true);
    expect((await access(editor, GUIDE)).canWrite).toBe(false);
  });

  it("lists what covers a page to anyone with Project Access, with names", async () => {
    await restrict(manager, { pathPrefix: FOLDER, kind: "publish", subjects: [{ kind: "user", id: leadId }] });
    const covering = (await reader.get<Restriction[]>(`/projects/shop/wiki/restrictions?path=${encodeURIComponent(GUIDE)}`)).body.data!;
    expect(covering).toEqual([
      { pathPrefix: FOLDER, kind: "publish", subjects: [{ kind: "user", id: leadId, name: "lead-l" }] },
      { pathPrefix: GUIDE, kind: "edit", subjects: [{ kind: "role", id: "wiki-leads", name: "wiki-leads" }] },
    ]);
    expect((await reader.get<Restriction[]>(`/projects/shop/wiki/restrictions?path=${encodeURIComponent("20-other/page.md")}`)).body.data).toEqual([]);
    expect(((await reader.get<Restriction[]>("/projects/shop/wiki/restrictions")).body.data ?? []).map((view) => `${view.pathPrefix}:${view.kind}`)).toEqual([`${FOLDER}:publish`, `${GUIDE}:edit`]);
  });

  it("needs wiki.manage to set or clear, and audits both with the prefix, the kind and who is let in", async () => {
    for (const client of [editor, reader]) {
      expect((await restrict(client, { pathPrefix: FOLDER, kind: "edit", subjects: [{ kind: "user", id: editorId }] })).status).toBe(403);
      expect((await unrestrict(client, GUIDE)).status).toBe(403);
    }
    const sets = await audit("wiki-restriction.set");
    expect(sets[0]).toEqual({ actor: managerId, subject: GUIDE, detail: { pathPrefix: GUIDE, kind: "edit", subjects: [{ kind: "role", id: "wiki-leads" }], username: "manager-m" } });
    expect(sets.length).toBeGreaterThanOrEqual(3);
    expect((await unrestrict(manager, GUIDE)).status).toBe(204);
    expect((await unrestrict(manager, GUIDE)).status).toBe(404);
    const clears = await audit("wiki-restriction.clear");
    expect(clears.at(-1)).toEqual({ actor: managerId, subject: GUIDE, detail: { pathPrefix: GUIDE, kind: "edit", removed: 1, username: "manager-m" } });
    expect((await access(editor, GUIDE)).canWrite).toBe(true);
  });

  it("replaces a prefix's list when set again, and refuses unknown people and roles, empty lists and bad prefixes", async () => {
    await restrict(manager, { pathPrefix: "30-pages/", kind: "edit", subjects: [{ kind: "user", id: editorId }, { kind: "role", id: "wiki-leads" }] });
    const replaced = await restrict(manager, { pathPrefix: "30-pages/", kind: "edit", subjects: [{ kind: "user", id: leadId }, { kind: "user", id: leadId }] });
    expect(replaced.body.data?.subjects).toEqual([{ kind: "user", id: leadId, name: "lead-l" }]);
    expect((await app.db.query("select 1 from knowledge.wiki_restriction where project_id = 'shop' and path_prefix = '30-pages/'")).rowCount).toBe(1);
    const bad = async (body: unknown) => (await restrict(manager, body)).status;
    expect(await bad({ pathPrefix: "30-pages/", kind: "edit", subjects: [{ kind: "user", id: "nobody" }] })).toBe(400);
    expect(await bad({ pathPrefix: "30-pages/", kind: "edit", subjects: [{ kind: "role", id: "no-such-role" }] })).toBe(400);
    expect(await bad({ pathPrefix: "30-pages/", kind: "edit", subjects: [] })).toBe(400);
    expect(await bad({ pathPrefix: "30-pages/", kind: "delete", subjects: [{ kind: "user", id: leadId }] })).toBe(400);
    for (const pathPrefix of ["/abs/", "a/../b/", "notes.txt", "a//b/", ""]) expect(await bad({ pathPrefix, kind: "edit", subjects: [{ kind: "user", id: leadId }] }), pathPrefix).toBe(400);
    expect(await bad({ pathPrefix: "30-pages/", kind: "edit", subjects: [{ kind: "user", id: leadId }], extra: 1 })).toBe(400);
    expect((await unrestrict(manager, "30-pages/")).status).toBe(204);
  });
});
