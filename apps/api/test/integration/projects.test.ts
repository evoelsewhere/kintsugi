// Projects (A1, ADR-0028): persisted in Postgres, repositories referenced from Settings ->
// Git and grouped AS-IS / TO-BE, the repository rules, and the rendered kintsugi.yaml.

import { parseKintsugiYaml } from "@kintsugi/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { type Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../support/app.js";

interface RepositoryView {
  repositoryId: string;
  role: string;
  component?: string;
  path: string;
}
interface ApplicationView {
  id: string;
  asIs: { legacy: RepositoryView[]; legacyData: RepositoryView[] };
  toBe: { document: RepositoryView | null; targets: RepositoryView[] };
}
interface ProjectDetail {
  id: string;
  documentRepositoryId: string;
  documentRepository: RepositoryView | null;
  applications: ApplicationView[];
}

const messages = (body: { message?: string | string[] }): string => [body.message ?? []].flat().join(" | ");

describe.skipIf(!hasDatabase)("projects (integration)", () => {
  let app: TestApp;
  let admin: Client;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    // Registration over HTTP needs a reachable remote (see git.test.ts); rows are enough here.
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('github', 'github', 'GitHub', 'https://github.example.invalid', 'none')");
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('azdo', 'azure-devops', 'Azure DevOps', 'https://dev.azure.example.invalid/org', 'none')");
    for (const [id, server, url] of [
      ["billing-docs", "github", "https://github.example.invalid/org/billing-docs.git"],
      ["web-legacy", "github", "https://github.example.invalid/org/web-legacy.git"],
      ["web-db", "github", "https://github.example.invalid/org/web-db.git"],
      ["web-api", "azdo", "https://dev.azure.example.invalid/org/Billing/_git/web-api"],
      ["web-ui", "azdo", "https://dev.azure.example.invalid/org/Billing/_git/web-ui"],
      ["payroll-docs", "github", "https://github.example.invalid/org/payroll-docs.git"],
    ]) {
      await app.db.query("insert into admin.git_repository (id, server_id, url) values ($1, $2, $3)", [id, server, url]);
    }
  });
  afterAll(async () => {
    await app?.close();
  });

  it("lets any member read and only projects.manage write", async () => {
    const { client } = await memberClient(app, admin, "reader", ["user"]);
    expect((await client.get("/admin/projects")).status).toBe(200);
    expect((await client.request("POST", "/admin/projects", { body: {} })).status).toBe(403);
    expect((await client.request("PATCH", "/admin/projects/any", { body: {} })).status).toBe(403);
    expect((await client.request("DELETE", "/admin/projects/any")).status).toBe(403);
    expect((await client.request("POST", "/admin/projects/any/applications", { body: {} })).status).toBe(403);
    expect((await client.request("POST", "/admin/projects/any/applications/a/repositories", { body: {} })).status).toBe(403);
    // Project managers can list registered repositories to pick from, without git.manage.
    expect((await client.get("/admin/git-repositories")).status).toBe(403);
    await subRole(admin, "project-lead", ["projects.manage"]);
    const { client: lead } = await memberClient(app, admin, "lead", ["user", "project-lead"]);
    expect((await lead.get("/admin/git-repositories")).status).toBe(200);
    expect((await lead.get("/admin/git-servers")).status).toBe(403);
  });

  it("creates a project with a registered document repository", async () => {
    const unknown = await admin.request("POST", "/admin/projects", { body: { id: "billing", name: "Billing", documentRepositoryId: "missing" } });
    expect(unknown.status).toBe(400);
    expect(messages(unknown.body)).toMatch(/not registered/);

    const created = await admin.request("POST", "/admin/projects", {
      body: { id: "billing", name: "Billing modernization", description: "Pilot", documentRepositoryId: "billing-docs" },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ id: "billing", name: "Billing modernization", description: "Pilot", documentRepositoryId: "billing-docs" });

    const again = await admin.request("POST", "/admin/projects", { body: { id: "billing", name: "Again", documentRepositoryId: "payroll-docs" } });
    expect(again.status).toBe(409);
    expect((await admin.request("POST", "/admin/projects", { body: { id: "Bad Id", name: "x", documentRepositoryId: "billing-docs" } })).status).toBe(400);
  });

  it("groups an application's repositories into AS-IS and TO-BE", async () => {
    const application = await admin.request("POST", "/admin/projects/billing/applications", {
      body: { id: "billing-web", name: "Billing web", pipeline: "custom" },
    });
    expect(application.status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/billing/applications", { body: { id: "billing-web", name: "x" } })).status).toBe(409);
    expect((await admin.request("POST", "/admin/projects/billing/applications", { body: { id: "Not An Id", name: "x" } })).status).toBe(400);

    const base = "/admin/projects/billing/applications/billing-web/repositories";
    expect((await admin.request("POST", base, { body: { repositoryId: "web-legacy", role: "legacy" } })).status).toBe(201);
    expect((await admin.request("POST", base, { body: { repositoryId: "web-db", role: "legacy-data" } })).status).toBe(201);
    const linked = await admin.request<ProjectDetail>("POST", base, { body: { repositoryId: "web-api", role: "target", component: "api" } });
    expect(linked.status).toBe(201);

    const detail = await admin.get<ProjectDetail>("/admin/projects/billing");
    expect(detail.status).toBe(200);
    const project = detail.body.data!;
    expect(project.documentRepository).toMatchObject({ repositoryId: "billing-docs", role: "document", path: "org/billing-docs" });
    const web = project.applications[0]!;
    expect(web.asIs.legacy.map((repo) => repo.repositoryId)).toEqual(["web-legacy"]);
    expect(web.asIs.legacyData.map((repo) => repo.repositoryId)).toEqual(["web-db"]);
    expect(web.toBe.document?.repositoryId).toBe("billing-docs");
    expect(web.toBe.targets).toMatchObject([{ repositoryId: "web-api", component: "api", path: "Billing/_git/web-api" }]);
  });

  it("enforces the repository rules with clear messages", async () => {
    const base = "/admin/projects/billing/applications/billing-web/repositories";
    const noComponent = await admin.request("POST", base, { body: { repositoryId: "web-ui", role: "target" } });
    expect(noComponent.status).toBe(400);
    expect(messages(noComponent.body)).toMatch(/needs the architecture component/);

    const legacyComponent = await admin.request("POST", base, { body: { repositoryId: "web-ui", role: "legacy", component: "ui" } });
    expect(messages(legacyComponent.body)).toMatch(/Only target repositories have a component/);

    const sameComponent = await admin.request("POST", base, { body: { repositoryId: "web-ui", role: "target", component: "api" } });
    expect(messages(sameComponent.body)).toMatch(/already has a target repository for component api/);

    const twice = await admin.request("POST", base, { body: { repositoryId: "web-legacy", role: "legacy-data" } });
    expect(twice.status).toBe(400);
    expect(messages(twice.body)).toMatch(/linked to this project more than once/);

    const documentAgain = await admin.request("POST", base, { body: { repositoryId: "billing-docs", role: "legacy" } });
    expect(messages(documentAgain.body)).toMatch(/more than once/);

    expect((await admin.request("POST", base, { body: { repositoryId: "web-ui", role: "document" } })).status).toBe(400);
    expect((await admin.request("POST", "/admin/projects/billing/applications/missing/repositories", { body: { repositoryId: "web-ui", role: "legacy" } })).status).toBe(404);
  });

  it("keeps a document repository to one project and lets legacy repositories be shared", async () => {
    const taken = await admin.request("POST", "/admin/projects", { body: { id: "payroll", name: "Payroll", documentRepositoryId: "billing-docs" } });
    expect(taken.status).toBe(400);
    const sharedAsDocument = await admin.request("POST", "/admin/projects", { body: { id: "payroll", name: "Payroll", documentRepositoryId: "web-legacy" } });
    expect(messages(sharedAsDocument.body)).toMatch(/document repository belongs to one project only/);

    expect((await admin.request("POST", "/admin/projects", { body: { id: "payroll", name: "Payroll", documentRepositoryId: "payroll-docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/payroll/applications", { body: { id: "batch", name: "Batch" } })).status).toBe(201);
    const base = "/admin/projects/payroll/applications/batch/repositories";
    expect((await admin.request("POST", base, { body: { repositoryId: "web-db", role: "legacy-data" } })).status).toBe(201);
    const otherDocument = await admin.request("POST", base, { body: { repositoryId: "billing-docs", role: "legacy" } });
    expect(messages(otherDocument.body)).toMatch(/is the document repository of project billing/);

    // Switching the document repo is checked the same way.
    expect((await admin.request("PATCH", "/admin/projects/payroll", { body: { documentRepositoryId: "billing-docs" } })).status).toBe(400);
  });

  it("updates projects and applications", async () => {
    const renamed = await admin.request("PATCH", "/admin/projects/billing", { body: { name: "Billing", description: null } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ name: "Billing", documentRepositoryId: "billing-docs" });
    expect(renamed.body.data).not.toHaveProperty("description");

    const application = await admin.request("PATCH", "/admin/projects/billing/applications/billing-web", { body: { pipeline: null } });
    expect(application.status).toBe(200);
    expect(application.body.data).toMatchObject({ id: "billing-web", name: "Billing web" });
    expect(application.body.data).not.toHaveProperty("pipeline");
    expect((await admin.request("PATCH", "/admin/projects/billing/applications/missing", { body: { name: "x" } })).status).toBe(404);
  });

  it("renders kintsugi.yaml from the project state", async () => {
    const rendered = await admin.get<{ fileName: string; content: string }>("/admin/projects/billing/kintsugi.yaml");
    expect(rendered.status).toBe(200);
    expect(rendered.body.data!.fileName).toBe("kintsugi.yaml");
    const parsed = parseKintsugiYaml(rendered.body.data!.content);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.manifest.project).toEqual({ id: "billing", name: "Billing" });
    expect(parsed.manifest.document).toEqual({ server: "github", path: "org/billing-docs" });
    expect(parsed.manifest.applications).toEqual([
      {
        id: "billing-web",
        name: "Billing web",
        repos: [
          { server: "github", path: "org/web-legacy", role: "legacy" },
          { server: "github", path: "org/web-db", role: "legacy-data" },
          { server: "azdo", path: "Billing/_git/web-api", role: "target", component: "api" },
        ],
      },
    ]);
    expect((await admin.get("/admin/projects/missing/kintsugi.yaml")).status).toBe(404);
  });

  it("keeps linked repositories registered until they are unlinked", async () => {
    expect((await admin.request("DELETE", "/admin/git-repositories/web-legacy")).status).toBe(409);
    expect((await admin.request("DELETE", "/admin/projects/billing/applications/billing-web/repositories/web-legacy")).status).toBe(204);
    expect((await admin.request("DELETE", "/admin/projects/billing/applications/billing-web/repositories/web-legacy")).status).toBe(404);
    expect((await admin.request("DELETE", "/admin/git-repositories/web-legacy")).status).toBe(204);
  });

  it("removes applications and projects with their links", async () => {
    expect((await admin.request("DELETE", "/admin/projects/billing/applications/billing-web")).status).toBe(204);
    const links = await app.db.query("select * from admin.project_repository where project_id = 'billing'");
    expect(links.rows.map((row) => row["role"])).toEqual(["document"]);

    expect((await admin.request("DELETE", "/admin/projects/billing")).status).toBe(204);
    expect((await admin.get("/admin/projects/billing")).status).toBe(404);
    const list = await admin.get<{ items: { id: string }[]; total: number }>("/admin/projects");
    expect(list.body.data).toMatchObject({ total: 1, items: [{ id: "payroll" }] });
    // The repositories stay registered.
    expect((await app.db.query("select 1 from admin.git_repository where id = 'billing-docs'")).rowCount).toBe(1);
  });
});
