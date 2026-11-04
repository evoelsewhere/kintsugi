// A new wiki page through the API (P2-034, ADR-0096 decisions 3 and 4, ADR-0098): the draft with its address, its id and
// the text of a template, on a real document mirror and the Brain built by the worker's own function.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageFromTemplate } from "@kintsugi/domain";
import { CheckoutStorage, cloneMirror } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { RepositoryStore } from "@kintsugi/orchestrator";
import { indexBrain } from "@kintsugi/orchestrator/brain";
import pg from "pg";
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
  writeId: string | null;
}
interface Template {
  path: string;
  title: string;
  summary: string;
}

const RUNBOOK = "---\ntype: template\ntitle: Runbook\nlabels: [runbook]\n# keep this comment\nowner: on-call-lead\n---\n\n# Runbook\n\n## Steps\n\n1. First\n";
const DECISION = "---\ntype: template\ntitle: Decision record\n---\n\n# Decision\r\n\r\n## Context\r\n";

describe.skipIf(!hasDatabase)("new wiki pages (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let editor: Client;
  let reader: Client;
  let remote: GitHttpServer;
  let dataDir: string;
  let pool: pg.Pool;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];
  const create = (client: Client, body: Record<string, unknown>) => client.request<Draft>("POST", "/projects/shop/wiki/pages", { body });
  const templates = (client: Client, folder: string) => client.get<Template[]>(`/projects/shop/wiki/templates?folder=${encodeURIComponent(folder)}`);

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-wiki-pages-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    await remote.commitFiles("docs", [
      { path: "20-spaces/eng/README.md", content: "---\nkey: ENG\n---\n\n# Engineering\n" },
      { path: "20-spaces/eng/guide.md", content: "---\nid: PAGE-ENG-0007\ntitle: Guide\n---\n\n# Guide\n" },
      { path: "20-spaces/eng/setup-guide.md", content: "---\nid: PAGE-ENG-0003\ntitle: Setup guide\n---\n\n# Setup guide\n" },
      { path: "20-spaces/eng/not-a-template.md", content: "# Plain\n" },
      { path: "20-spaces/eng/_templates/runbook.md", content: RUNBOOK },
      { path: "20-spaces/hr/README.md", content: "---\nkey: HR\n---\n\n# People\n" },
      { path: "20-spaces/hr/_templates/policy.md", content: "---\ntype: template\ntitle: Policy\n---\n\n# Policy\n" },
      { path: "01-standards/page-templates/decision.md", content: DECISION },
      { path: "00-project/charter.md", content: "# Charter\n" },
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

  it("lists the templates of the folder's space and the system ones, from the Brain, read-only", async () => {
    const eng = await templates(editor, "20-spaces/eng");
    expect(eng.status).toBe(200);
    expect(eng.body.data?.map((template) => [template.path, template.title])).toEqual([
      ["01-standards/page-templates/decision.md", "Decision record"],
      ["20-spaces/eng/_templates/runbook.md", "Runbook"],
    ]);
    // A folder below the space finds the space's templates too; another space has its own; a folder outside any space has the system ones.
    expect((await templates(editor, "20-spaces/eng/runbooks")).body.data?.map((template) => template.path)).toEqual(["01-standards/page-templates/decision.md", "20-spaces/eng/_templates/runbook.md"]);
    expect((await templates(editor, "20-spaces/hr")).body.data?.map((template) => template.path)).toEqual(["01-standards/page-templates/decision.md", "20-spaces/hr/_templates/policy.md"]);
    expect((await templates(editor, "00-project")).body.data?.map((template) => template.path)).toEqual(["01-standards/page-templates/decision.md"]);
    // Anyone with Project Access reads them; a person without it does not.
    expect((await templates(reader, "20-spaces/eng")).status).toBe(200);
    const { client: stranger } = await memberClient(app, admin, "stranger", ["user", "wiki-editor"], []);
    expect((await templates(stranger, "20-spaces/eng")).status).toBe(403);
  });

  it("makes a draft at revision 1 with the id after the highest of the space, and no write", async () => {
    const result = await create(editor, { folder: "20-spaces/eng", title: "Payment outage" });
    expect(result.status, result.raw).toBe(200);
    // The Brain holds PAGE-ENG-0007: the first id of the scope comes after it.
    expect(result.body.data).toMatchObject({ path: "20-spaces/eng/payment-outage.md", pageId: "PAGE-ENG-0008", revision: 1, baseCommit: null, baseHash: null, writeId: null });
    expect(result.body.data?.text).toBe('---\nid: PAGE-ENG-0008\ntitle: "Payment outage"\n---\n\n# Payment outage\n');
    expect((await app.db.query("select 1 from workflow.document_write")).rowCount).toBe(0);
    expect((await app.db.query("select 1 from knowledge.wiki_draft where page_path = '20-spaces/eng/payment-outage.md'")).rowCount).toBe(1);
  });

  it("names a page of the same title -2, -3 while a page or a draft has the name, and a title of an existing page the same", async () => {
    expect((await create(editor, { folder: "20-spaces/eng", title: "Payment outage" })).body.data?.path).toBe("20-spaces/eng/payment-outage-2.md");
    expect((await create(editor, { folder: "20-spaces/eng", title: "Payment outage!" })).body.data?.path).toBe("20-spaces/eng/payment-outage-3.md");
    expect((await create(editor, { folder: "20-spaces/eng/", title: "Setup guide" })).body.data?.path).toBe("20-spaces/eng/setup-guide-2.md");
  });

  it("gives two parallel creations two different ids, and scopes ids by space, DOC outside one", async () => {
    const [one, two] = await Promise.all([create(editor, { folder: "20-spaces/hr", title: "Leave one" }), create(editor, { folder: "20-spaces/hr", title: "Leave two" })]);
    const ids = [one.body.data?.pageId, two.body.data?.pageId].sort();
    expect(ids).toEqual(["PAGE-HR-0001", "PAGE-HR-0002"]);
    expect((await create(editor, { folder: "00-project", title: "Plan" })).body.data?.pageId).toBe("PAGE-DOC-0001");
    // A folder that is new takes the space of the nearest folder the Brain knows.
    expect((await create(editor, { folder: "20-spaces/hr/benefits", title: "Health" })).body.data?.pageId).toBe("PAGE-HR-0003");
  });

  it("starts from a template: the draft is pageFromTemplate of it, byte for byte, in the new id and title", async () => {
    const result = await create(editor, { folder: "20-spaces/eng", title: "Database failover", templatePath: "20-spaces/eng/_templates/runbook.md" });
    expect(result.status).toBe(200);
    const id = result.body.data?.pageId ?? "";
    expect(id).toMatch(/^PAGE-ENG-\d{4}$/);
    expect(result.body.data?.text).toBe(pageFromTemplate(RUNBOOK, { id, title: "Database failover" }));
    expect(result.body.data?.text).toContain("# keep this comment\nowner: on-call-lead");
    expect(result.body.data?.text).not.toContain("type: template");
    // A system template with CRLF in its body keeps its endings.
    const decision = await create(editor, { folder: "20-spaces/eng", title: "Use queues", templatePath: "01-standards/page-templates/decision.md" });
    expect(decision.body.data?.text).toBe(pageFromTemplate(DECISION, { id: decision.body.data?.pageId ?? "", title: "Use queues" }));
    expect(decision.body.data?.text).toContain("# Decision\r\n\r\n## Context\r\n");
  });

  it("refuses a title or folder that cannot name a page, and a template that is not one that applies", async () => {
    for (const body of [{ folder: "20-spaces/eng", title: "   " }, { folder: "20-spaces/eng", title: "???" }, { folder: "20-spaces/eng", title: "x".repeat(201) }, { folder: "/", title: "A page" }, { folder: "20-spaces/eng", title: "A\nB" }]) {
      expect((await create(editor, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await create(editor, { folder: "plugins/x", title: "A page" })).status).toBe(400);
    expect((await create(editor, { folder: "20-spaces/eng", title: "A", templatePath: "20-spaces/eng/not-a-template.md" })).status).toBe(400);
    expect((await create(editor, { folder: "20-spaces/eng", title: "A", templatePath: "20-spaces/hr/_templates/policy.md" })).status).toBe(400);
    expect((await create(editor, { folder: "20-spaces/eng", title: "A", templatePath: "20-spaces/eng/_templates/missing.md" })).status).toBe(404);
    expect((await create(editor, { folder: "20-spaces/eng", title: "A", extra: true })).status).toBe(400);
  });

  it("refuses a member without wiki.write and a person without Project Access, and makes no draft", async () => {
    const before = (await app.db.query("select 1 from knowledge.wiki_draft")).rowCount;
    expect((await create(reader, { folder: "20-spaces/eng", title: "Not allowed" })).status).toBe(403);
    const { client: stranger } = await memberClient(app, admin, "stranger-two", ["user", "wiki-editor"], []);
    expect((await create(stranger, { folder: "20-spaces/eng", title: "Not allowed" })).status).toBe(403);
    expect((await app.db.query("select 1 from knowledge.wiki_draft")).rowCount).toBe(before);
  });
});
