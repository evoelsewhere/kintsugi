// Document writes (ADR-0019): publishing kintsugi.yaml records a queued write and enqueues it
// on the worker's `document-write` queue (keyed by the document repository); the list shows
// the outcome the worker records. The worker itself is tested in services/orchestrator.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseKintsugiYaml } from "@kintsugi/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocumentWritesService } from "#modules/admin/document-writes/index.js";
import { hasDatabase } from "../support/database.js";
import { type Client, adminClient, memberClient, startTestApp, type TestApp, currentUserId, grantProjectAccess } from "../support/app.js";

interface WriteView {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  message: string;
  actor?: string;
  prUrl?: string;
  branch?: string;
}

describe.skipIf(!hasDatabase)("document writes (integration)", () => {
  let app: TestApp;
  let admin: Client;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('github', 'github', 'GitHub', 'https://github.example.invalid', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url) values ('billing-docs', 'github', 'https://github.example.invalid/org/billing-docs.git')");
    const created = await admin.request("POST", "/admin/projects", { body: { id: "billing", name: "Billing", documentRepositoryId: "billing-docs" } });
    expect(created.status).toBe(201);
    await grantProjectAccess(admin, "billing", await currentUserId(admin));
  });
  afterAll(async () => {
    await app?.close();
  });

  it("publishing needs projects.manage; reading needs Project Access", async () => {
    const { client } = await memberClient(app, admin, "reader", ["user"]);
    expect((await client.request("POST", "/admin/projects/billing/kintsugi.yaml/publish")).status).toBe(403);
    expect((await client.get("/admin/projects/billing/document-writes")).status).toBe(403);
    const { client: granted } = await memberClient(app, admin, "granted-reader", ["user"], ["billing"]);
    expect((await granted.get("/admin/projects/billing/document-writes")).status).toBe(200);
  });

  it("enqueues the rendered kintsugi.yaml alone, as a write keyed by the document repository, when the starter structure is off", async () => {
    const published = await admin.request<WriteView>("POST", "/admin/projects/billing/kintsugi.yaml/publish", { body: { scaffold: false } });
    expect(published.status).toBe(202);
    const write = published.body.data!;
    expect(write).toMatchObject({ projectId: "billing", kind: "manifest", status: "queued", actor: "admin", message: "Publish kintsugi.yaml from the project settings" });

    const jobs = await app.db.query<{ singleton_key: string; data: { writeId: string; files: Array<{ path: string; content: string }>; actor: string } }>(
      "select singleton_key, data from pgboss.job where name = 'document-write'",
    );
    expect(jobs.rows).toHaveLength(1);
    const job = jobs.rows[0]!;
    expect(job.singleton_key).toBe("billing-docs");
    expect(job.data).toMatchObject({ writeId: write.id, projectId: "billing", kind: "manifest", actor: "admin" });
    expect(job.data.files.map((file) => file.path)).toEqual(["kintsugi.yaml"]);
    const manifest = parseKintsugiYaml(job.data.files[0]!.content);
    expect(manifest.ok).toBe(true);

    const listed = await admin.get<{ items: WriteView[]; total: number }>("/admin/projects/billing/document-writes");
    expect(listed.body.data).toMatchObject({ total: 1, items: [{ id: write.id, status: "queued" }] });
  });

  it("lists the outcome recorded by the worker, newest first", async () => {
    const second = (await admin.request<WriteView>("POST", "/admin/projects/billing/kintsugi.yaml/publish")).body.data!;
    await app.db.query(
      "update workflow.document_write set status = 'pr-opened', branch = 'kintsugi/admin/x', pr_url = 'https://github.example.invalid/org/billing-docs/pull/1', created_at = now() + interval '1 second' where id = $1",
      [second.id],
    );
    const listed = await admin.get<{ items: WriteView[]; total: number }>("/admin/projects/billing/document-writes?limit=1");
    expect(listed.body.data).toMatchObject({ total: 2, items: [{ id: second.id, status: "pr-opened", prUrl: "https://github.example.invalid/org/billing-docs/pull/1" }] });
  });

  it("answers 404 for an unknown project", async () => {
    expect((await admin.request("POST", "/admin/projects/missing/kintsugi.yaml/publish")).status).toBe(404);
    expect((await admin.get("/admin/projects/missing/document-writes")).status).toBe(403); // no grant can exist on a project that does not
  });

  it("publishes the starter structure with the manifest: one pull request, create-only files, one skeleton per application", async () => {
    const application = await admin.request("POST", "/admin/projects/billing/applications", { body: { id: "web", name: "Web" } });
    expect(application.status).toBe(201);
    const before = await app.db.query<{ id: string }>("select id from pgboss.job where name = 'document-write'");

    const published = await admin.request<WriteView>("POST", "/admin/projects/billing/kintsugi.yaml/publish");
    expect(published.status).toBe(202);
    expect(published.body.data?.message).toBe("Publish kintsugi.yaml and the starter structure from the project settings");

    const jobs = await app.db.query<{ data: { writeId: string; reviewAll?: boolean; files: Array<{ path: string; content: string; createOnly?: boolean }> } }>(
      "select data from pgboss.job where name = 'document-write' and data->>'writeId' = $1",
      [published.body.data!.id],
    );
    expect(before.rows.length).toBeGreaterThan(0);
    const { data } = jobs.rows[0]!;
    expect(data.reviewAll).toBe(true);
    const paths = data.files.map((file) => file.path);
    // The manifest is rendered and replaces; everything else only fills in what is missing.
    expect(data.files.find((file) => file.path === "kintsugi.yaml")?.createOnly).toBeUndefined();
    expect(data.files.filter((file) => file.path !== "kintsugi.yaml").every((file) => file.createOnly === true)).toBe(true);
    expect(paths).toEqual(expect.arrayContaining(["00-project/charter.md", "00-project/glossary.md", "01-standards/review-rules.md", "02-architecture/blueprint.md", "03-transition/README.md", "00-project/portfolio/scorecard.md", "10-applications/README.md"]));
    // Gate decisions live in the portal: the starter has no gate records (ADR-0051).
    expect(paths.some((path) => /(^|\/)gates\//.test(path))).toBe(false);
    // The application skeleton is made for this project's application; the starter holds no application, and samples do not travel.
    expect(paths).toEqual(expect.arrayContaining(["10-applications/web/README.md", "10-applications/web/01-legacy/README.md", "10-applications/web/02-modern/README.md", "10-applications/web/_generated/README.md"]));
    expect(paths.filter((path) => path.startsWith("10-applications/")).every((path) => path === "10-applications/README.md" || path.startsWith("10-applications/web/"))).toBe(true);
    expect(paths.some((path) => path.includes(".example"))).toBe(false);
    const skeleton = data.files.filter((file) => file.path.startsWith("10-applications/web/"));
    expect(skeleton.some((file) => file.content.includes("{{app}}"))).toBe(false);
    expect(skeleton.find((file) => file.path === "10-applications/web/README.md")?.content).toContain("# `10-applications/web/`");
    expect(new Set(paths).size).toBe(paths.length);
  });

  describe("page writes (ADR-0098)", () => {
    const HASH = "c".repeat(64);
    const actor = { id: "u-page", username: "page-author", permissions: [] as string[] };
    let writes: DocumentWritesService;
    const payload = async (id: string) =>
      (await app.db.query<{ data: Record<string, unknown> & { files: Array<Record<string, unknown>> } }>("select data from pgboss.job where name = 'document-write' and data->>'writeId' = $1", [id])).rows[0]!.data;

    beforeAll(() => {
      writes = app.nest.get(DocumentWritesService, { strict: false });
    });

    it("runs migration 055 again without error and adds the page columns and the open-write index", async () => {
      const script = await readFile(resolve(import.meta.dirname, "../../migrations/055_document_write_page.sql"), "utf8");
      await app.db.query(script);
      await app.db.query(script);
      const columns = await app.db.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'workflow' and table_name = 'document_write' and column_name in ('merge_commit', 'page_path', 'page_id') order by 1",
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual(["merge_commit", "page_id", "page_path"]);
      const indexes = await app.db.query<{ indexname: string }>("select indexname from pg_indexes where schemaname = 'workflow' and tablename = 'document_write' and indexname = 'document_write_open_page'");
      expect(indexes.rows).toHaveLength(1);
    });

    it("queues a page write with base64, delete, rename, directPublish, continues and the page, and records the page", async () => {
      const record = await writes.proposePage(
        "billing",
        {
          message: "Update the naming standard",
          files: [
            { path: "01-standards/naming.md", content: "# Naming\n", expectedHash: HASH },
            { path: "01-standards/_attachments/figure.png", content: Buffer.from([137, 80, 78, 71]).toString("base64"), encoding: "base64" },
            { path: "01-standards/old.md", content: "", delete: true, expectedHash: HASH },
            { path: "01-standards/moved.md", content: "# Moved\n", renameFrom: "01-standards/before.md", expectedHash: HASH },
          ],
          page: { id: "PAGE-BIL-0001", path: "01-standards/naming.md", minor: true },
          directPublish: true,
          continues: "kintsugi/page-author/naming",
        },
        actor,
      );
      expect(record).toMatchObject({ kind: "page", status: "queued", actor: "page-author", page: { path: "01-standards/naming.md", id: "PAGE-BIL-0001" } });
      const data = await payload(record.id);
      expect(data).toMatchObject({ kind: "page", directPublish: true, continues: "kintsugi/page-author/naming", page: { id: "PAGE-BIL-0001", path: "01-standards/naming.md", minor: true }, actor: "page-author" });
      expect(data.files).toEqual([
        { path: "01-standards/naming.md", content: "# Naming\n", expectedHash: HASH },
        { path: "01-standards/_attachments/figure.png", content: "iVBORw==", encoding: "base64" },
        { path: "01-standards/old.md", content: "", delete: true, expectedHash: HASH },
        { path: "01-standards/moved.md", content: "# Moved\n", renameFrom: "01-standards/before.md", expectedHash: HASH },
      ]);
      // Without directPublish and continues, neither is in the payload.
      const plain = await writes.proposePage("billing", { message: "Plain", files: [{ path: "a-plain.md", content: "# A\n" }], page: { id: null, path: "a-plain.md", minor: false } }, actor);
      const plainData = await payload(plain.id);
      expect(plainData).not.toHaveProperty("directPublish");
      expect(plainData).not.toHaveProperty("continues");
      expect(plainData).toMatchObject({ page: { id: null, path: "a-plain.md", minor: false } });
    });

    it("refuses what the contract does with a 400 naming the path, and records nothing", async () => {
      const before = (await app.db.query("select 1 from workflow.document_write")).rowCount;
      const tries: Array<[string, Parameters<DocumentWritesService["proposePage"]>[1]]> = [
        ["restricted/secret.md", { message: "m", files: [{ path: "restricted/secret.md", content: "x" }], page: { id: null, path: "restricted/secret.md", minor: false } }],
        ["../escape.md", { message: "m", files: [{ path: "../escape.md", content: "x" }], page: { id: null, path: "a.md", minor: false } }],
        ["gone.md", { message: "m", files: [{ path: "gone.md", content: "", delete: true }], page: { id: null, path: "gone.md", minor: false } }],
        ["dup.md", { message: "m", files: [{ path: "dup.md", content: "x" }, { path: "dup.md", content: "y" }], page: { id: null, path: "dup.md", minor: false } }],
        ["same.md", { message: "m", files: [{ path: "same.md", content: "x", renameFrom: "same.md", expectedHash: HASH }], page: { id: null, path: "same.md", minor: false } }],
      ];
      for (const [name, input] of tries) await expect(writes.proposePage("billing", input, actor), name).rejects.toMatchObject({ status: 400, message: expect.stringContaining(name) });
      expect((await app.db.query("select 1 from workflow.document_write")).rowCount).toBe(before);
    });

    it("finds the open write of a page: queued, or on a review branch, not merged, closed, direct or failed", async () => {
      const page = "10-open/page.md";
      const propose = (path = page) => writes.proposePage("billing", { message: "Open", files: [{ path, content: "# Open\n" }], page: { id: null, path, minor: false } }, actor);
      expect(await writes.openPageWrite("billing", page)).toBeUndefined();
      const first = await propose();
      expect((await writes.openPageWrite("billing", page))?.id).toBe(first.id);
      const set = (id: string, status: string, branch: string | null) => app.db.query("update workflow.document_write set status = $2, branch = $3 where id = $1", [id, status, branch]);
      await set(first.id, "pr-opened", "kintsugi/page-author/open");
      expect(await writes.openPageWrite("billing", page)).toMatchObject({ id: first.id, status: "pr-opened", branch: "kintsugi/page-author/open" });
      await set(first.id, "committed", "kintsugi/page-author/open");
      expect((await writes.openPageWrite("billing", page))?.id).toBe(first.id);
      // Committed straight to the default branch (no branch), merged, closed, unchanged and failed are not open.
      for (const [status, branch] of [["committed", null], ["merged", "kintsugi/page-author/open"], ["closed", "kintsugi/page-author/open"], ["unchanged", null], ["failed", null]] as const) {
        await set(first.id, status, branch);
        expect(await writes.openPageWrite("billing", page), status).toBeUndefined();
      }
      // Another page, another project's page and a write that is not a page write are not it.
      await set(first.id, "queued", null);
      expect(await writes.openPageWrite("billing", "10-open/other.md")).toBeUndefined();
      expect(await writes.openPageWrite("elsewhere", page)).toBeUndefined();
      await app.db.query("update workflow.document_write set page_path = null where id = $1", [first.id]);
      expect(await writes.openPageWrite("billing", page)).toBeUndefined();
      // The newest open write wins when the data holds two.
      const older = await propose();
      const newer = await propose();
      await app.db.query("update workflow.document_write set created_at = now() + interval '5 seconds' where id = $1", [newer.id]);
      expect((await writes.openPageWrite("billing", page))?.id).toBe(newer.id);
      expect(older.id).not.toBe(newer.id);
    });

    it("lists the page and the merge commit of a write in the project's writes", async () => {
      const record = await writes.proposePage("billing", { message: "Merged", files: [{ path: "20-merged.md", content: "# M\n" }], page: { id: "PAGE-BIL-0002", path: "20-merged.md", minor: false } }, actor);
      await app.db.query("update workflow.document_write set status = 'merged', branch = 'kintsugi/x', merge_commit = $2 where id = $1", [record.id, "d".repeat(40)]);
      const listed = await admin.get<{ items: Array<{ id: string; page?: { path: string; id: string | null }; mergeCommit?: string }> }>("/admin/projects/billing/document-writes?limit=100");
      expect(listed.body.data!.items.find((item) => item.id === record.id)).toMatchObject({ page: { path: "20-merged.md", id: "PAGE-BIL-0002" }, mergeCommit: "d".repeat(40) });
    });

    it("leaves the manifest write as it was: no page, no new payload fields", async () => {
      const published = (await admin.request<WriteView>("POST", "/admin/projects/billing/kintsugi.yaml/publish", { body: { scaffold: false } })).body.data!;
      const data = await payload(published.id);
      for (const key of ["page", "directPublish", "continues"]) expect(data).not.toHaveProperty(key);
      expect(data.files).toHaveLength(1);
      expect(data.files[0]).not.toHaveProperty("encoding");
      expect((published as WriteView & { page?: unknown }).page).toBeUndefined();
    });
  });
});
