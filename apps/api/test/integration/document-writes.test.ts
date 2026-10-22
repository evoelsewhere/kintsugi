// Document writes (ADR-0019): publishing kintsugi.yaml records a queued write and enqueues it
// on the worker's `document-write` queue (keyed by the document repository); the list shows
// the outcome the worker records. The worker itself is tested in services/orchestrator.

import { parseKintsugiYaml } from "@kintsugi/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { type Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

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
  });
  afterAll(async () => {
    await app?.close();
  });

  it("publishing needs projects.manage; reading needs a session", async () => {
    const { client } = await memberClient(app, admin, "reader", ["user"]);
    expect((await client.request("POST", "/admin/projects/billing/kintsugi.yaml/publish")).status).toBe(403);
    expect((await client.get("/admin/projects/billing/document-writes")).status).toBe(200);
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
    expect((await admin.get("/admin/projects/missing/document-writes")).status).toBe(404);
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
    // The template's sample application becomes this project's application; samples and the sample's own name do not travel.
    expect(paths).toEqual(expect.arrayContaining(["10-applications/web/README.md", "10-applications/web/01-legacy/README.md", "10-applications/web/02-modern/README.md", "10-applications/web/_generated/README.md"]));
    expect(paths.some((path) => path.includes("billing-web") || path.includes(".example"))).toBe(false);
    expect(data.files.filter((file) => file.path.startsWith("10-applications/web/")).some((file) => file.content.includes("billing-web"))).toBe(false);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
