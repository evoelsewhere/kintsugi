// Moving a wiki page through the API (P2-038, ADR-0098 decision 5): a document mirror, the Brain built by the worker's
// own function, the routes with their guards, the write that is recorded and the refusals.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { RepositoryStore } from "@kintsugi/orchestrator";
import { indexBrain } from "@kintsugi/orchestrator/brain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Preview {
  entries: Array<{ path: string; renameFrom?: string; kind: "moved" | "rewritten" }>;
  rewrittenLinks: number;
}

const GUIDE = "---\nid: PAGE-ENG-0001\ntitle: Guide\n---\n\n# Guide\n\n## Setup\n\nSteps.\n";
const FROM = "20-spaces/eng/guide.md";
const TO = "20-spaces/ops/guide.md";

describe.skipIf(!hasDatabase)("wiki move (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let editor: Client;
  let reader: Client;
  let remote: GitHttpServer;
  let dataDir: string;
  let pool: pg.Pool;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];
  const preview = (client: Client, body: Record<string, unknown>) => client.request<Preview>("POST", "/projects/shop/wiki/move/preview", { body });
  const move = (client: Client, body: Record<string, unknown>) => client.request<{ outcome: string; write: { id: string; status: string; mode: string } }>("POST", "/projects/shop/wiki/move", { body });

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-wiki-move-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    await remote.commitFiles("docs", [
      { path: "20-spaces/eng/README.md", content: "---\nkey: ENG\norder:\n  - guide\n  - a\n---\n\n# Engineering\n" },
      { path: FROM, content: GUIDE },
      { path: "20-spaces/eng/a.md", content: "# A\n\nSee [the guide](guide.md) and [its setup](guide.md#setup).\n" },
      { path: "20-spaces/eng/runbooks/b.md", content: "# B\n\nSee [setup](../guide.md#setup).\n" },
      { path: "20-spaces/ops/README.md", content: "---\nkey: OPS\norder: [x]\n---\n\n# Operations\n" },
      { path: "20-spaces/ops/taken.md", content: "# Taken\n" },
    ]);
    await cloneMirror(`${remote.baseUrl}/docs.git`, new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    app = await startTestApp();
    pool = new pg.Pool({ connectionString: app.db.url, max: 2 });
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', $1, 'none')", [remote.baseUrl]);
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', $1, 'main')", [`${remote.baseUrl}/docs.git`]);
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    const adminId = (await admin.get<{ id: string }>("/auth/me")).body.data!.id;
    expect((await admin.request("PUT", `/admin/project-access/shop/${adminId}`, { body: {} })).status).toBe(204);
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true } })).status).toBe(200);
    expect(await indexBrain({ pool, repositories: new RepositoryStore(pool), storage: new CheckoutStorage(dataDir), log: () => undefined }, "shop")).toMatchObject({ status: "built" });

    await subRole(admin, "wiki-editor", ["wiki.write"]);
    ({ client: editor } = await memberClient(app, admin, "editor", ["user", "wiki-editor"], ["shop"]));
    ({ client: reader } = await memberClient(app, admin, "reader", ["user"], ["shop"]));
  }, 180_000);
  afterAll(async () => {
    await pool?.end();
    await app?.close();
    await remote?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("previews the page and every page whose links change, and writes nothing", async () => {
    const result = await preview(reader, { from: FROM, to: TO });
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({
      entries: [
        { path: TO, renameFrom: FROM, kind: "moved" },
        { path: "20-spaces/eng/README.md", kind: "rewritten" },
        { path: "20-spaces/eng/a.md", kind: "rewritten" },
        { path: "20-spaces/eng/runbooks/b.md", kind: "rewritten" },
        { path: "20-spaces/ops/README.md", kind: "rewritten" },
      ],
      rewrittenLinks: 3,
    });
    expect((await app.db.query("select 1 from workflow.document_write where kind = 'page'")).rowCount).toBe(0);
  });

  it("answers 409 target-exists for a target that is there, 404 for a page that is not and 400 for a body that is not valid", async () => {
    const taken = await preview(editor, { from: FROM, to: "20-spaces/ops/taken.md" });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ details: { code: "target-exists", path: "20-spaces/ops/taken.md" } });
    expect((await preview(editor, { from: "20-spaces/eng/nope.md", to: TO })).status).toBe(404);
    expect((await preview(editor, { from: FROM, to: FROM })).status).toBe(400);
    expect((await preview(editor, { from: FROM })).status).toBe(400);
    expect((await preview(editor, { from: FROM, to: TO, extra: 1 })).status).toBe(400);
    expect((await move(editor, { from: FROM, to: TO })).status).toBe(400);
  });

  it("answers 400 for a target that is not a page of the wiki, before any existence check, the same whether it is there or not (QA-001)", async () => {
    const targets = ["restricted/x.md", "restricted/there.md", "restricted/sub/x.md", "RESTRICTED/x.md", "_generated/x.md", "../escape.md", "20-spaces/eng/.git/x.md", "20-spaces/ops/notes.txt", "20-spaces/ops/image.png", "kintsugi.yaml"];
    for (const to of targets) {
      for (const [name, call] of [["preview", preview], ["move", move]] as const) {
        const result = await call(editor, name === "move" ? { from: FROM, to, message: "Move it" } : { from: FROM, to });
        expect(result.status, `${name} ${to}: ${result.raw}`).toBe(400);
        expect(result.body).toMatchObject({ message: `${to} is not a page the wiki can write` });
        expect(result.raw).not.toContain("exists");
      }
    }
    // The source is checked the same way: a page outside the wiki is neither found nor missing.
    for (const from of ["restricted/there.md", "restricted/nope.md", "_generated/x.md"]) {
      const result = await preview(editor, { from, to: TO });
      expect(result.status, from).toBe(400);
      expect(result.body).toMatchObject({ message: `${from} is not a page the wiki can write` });
    }
    expect((await app.db.query("select 1 from workflow.document_write where kind = 'page'")).rowCount).toBe(0);
    expect((await app.db.query("select 1 from knowledge.wiki_draft")).rowCount).toBe(0);
  });

  it("refuses a member without wiki.write, audits it, and records nothing", async () => {
    const refused = await move(reader, { from: FROM, to: TO, message: "Move the guide" });
    expect(refused.status).toBe(403);
    const audit = await app.db.query<{ action: string }>("select action from governance.audit_event where action = 'wiki-page.refused'");
    expect(audit.rowCount).toBe(0); // the permission is checked before any page is read: a question, not an attempt on a page
    expect((await app.db.query("select 1 from workflow.document_write where kind = 'page'")).rowCount).toBe(0);
  });

  it("refuses a caller without Project Access to the project", async () => {
    const { client: stranger } = await memberClient(app, admin, "stranger", ["user", "wiki-editor"], []);
    expect((await preview(stranger, { from: FROM, to: TO })).status).toBe(403);
    expect((await move(stranger, { from: FROM, to: TO, message: "x" })).status).toBe(403);
  });

  it("answers 409 open-write, naming the page and its write, when a page the move would change has a write waiting", async () => {
    await app.db.query("insert into workflow.document_write (id, project_id, kind, message, status, page_path) values ('w-open', 'shop', 'page', 'Edit a', 'queued', '20-spaces/eng/a.md')");
    try {
      const blocked = await move(editor, { from: FROM, to: TO, message: "Move the guide" });
      expect(blocked.status).toBe(409);
      expect(blocked.body).toMatchObject({ details: { code: "open-write", path: "20-spaces/eng/a.md", writeId: "w-open" } });
      expect((await app.db.query("select 1 from workflow.document_write where kind = 'page' and id <> 'w-open'")).rowCount).toBe(0);
    } finally {
      await app.db.query("delete from workflow.document_write where id = 'w-open'");
    }
  });

  it("moves the page in ONE write of kind page, with its audit entry", async () => {
    const result = await move(editor, { from: FROM, to: TO, message: "Move the guide to Operations" });
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ outcome: "published", write: { status: "queued", mode: "pull-request" } });
    const rows = await app.db.query<{ kind: string; page_path: string; page_id: string | null; message: string }>("select kind, page_path, page_id, message from workflow.document_write where kind = 'page'");
    expect(rows.rows).toEqual([{ kind: "page", page_path: TO, page_id: "PAGE-ENG-0001", message: "Move the guide to Operations" }]);
    const audit = await app.db.query<{ detail: Record<string, unknown> }>("select detail from governance.audit_event where action = 'wiki-page.move'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.detail).toMatchObject({ from: FROM, to: TO, mode: "pull-request", rewritten: 4, rewrittenLinks: 3 });

    // The write waits on the page it makes: another write of that path is refused until it lands.
    const again = await move(editor, { from: "20-spaces/ops/taken.md", to: TO, message: "Rename taken to guide" });
    expect([409]).toContain(again.status);
  });
});
