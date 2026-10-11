// Audit coverage of admin actions: changes made through the API leave entries in the audit log
// (governance · audit), with ids, names and changed field names only, never credentials.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { type Client, adminClient, startTestApp, type TestApp } from "../support/app.js";

interface AuditEntry {
  actor: string;
  action: string;
  projectId?: string;
  subject?: string;
  detail: Record<string, unknown>;
}

const API_KEY = "sk-test-AUDIT-SECRET-0123456789";

describe.skipIf(!hasDatabase)("audit coverage (integration)", () => {
  let app: TestApp;
  let admin: Client;

  const entries = async (action: string): Promise<AuditEntry[]> => {
    const response = await admin.get<{ items: AuditEntry[] }>(`/governance/audit?action=${action}&limit=100`);
    expect(response.status, response.raw).toBe(200);
    return response.body.data!.items;
  };

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    // Registration over HTTP needs a reachable remote (see git.test.ts); rows are enough here.
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('github', 'github', 'GitHub', 'https://github.example.invalid', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url) values ('audit-docs', 'github', 'https://github.example.invalid/org/audit-docs.git')");
  });
  afterAll(async () => {
    await app?.close();
  });

  it("lists the admin actions in the filter catalog", async () => {
    const actions = (await admin.get<string[]>("/governance/audit/actions")).body.data!;
    for (const action of [
      "project.create",
      "project.update",
      "project.delete",
      "repository.link",
      "git-server.create",
      "llm-provider.create",
      "model-bindings.save",
      "agent.create",
      "skill.create",
      "commit-identity.update",
      "role.create",
      "role.permissions",
      "user.create",
      "user.password",
      "manifest.publish",
    ]) {
      expect(actions).toContain(action);
    }
  });

  it("audits project create, update and delete with changed field names", async () => {
    expect((await admin.request("POST", "/admin/projects", { body: { id: "audited", name: "Audited", documentRepositoryId: "audit-docs" } })).status).toBe(201);
    expect((await admin.request("PATCH", "/admin/projects/audited", { body: { name: "Audited project", description: "Renamed" } })).status).toBe(200);
    expect((await admin.request("DELETE", "/admin/projects/audited")).status).toBe(204);

    const [created] = await entries("project.create");
    expect(created).toMatchObject({ action: "project.create", projectId: "audited", subject: "audited", detail: { username: "admin" } });
    const [updated] = await entries("project.update");
    expect(updated).toMatchObject({ projectId: "audited", subject: "audited", detail: { fields: ["description", "name"] } });
    expect(JSON.stringify(updated)).not.toContain("Renamed");
    expect(await entries("project.delete")).toEqual([expect.objectContaining({ projectId: "audited", subject: "audited" })]);
  });

  it("audits an LLM provider without its key value", async () => {
    const created = await admin.request("POST", "/admin/llm-providers", {
      body: { kind: "custom", id: "audit-gateway", api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", models: [{ id: "m1" }], apiKey: API_KEY },
    });
    expect(created.status, created.raw).toBe(201);
    expect((await admin.request("PUT", "/admin/llm-providers/model-bindings", { body: [{ agent: "some-agent", provider: "audit-gateway", model: "m1" }] })).status).toBe(200);

    const [provider] = await entries("llm-provider.create");
    expect(provider).toMatchObject({ subject: "audit-gateway", detail: { kind: "custom", api: "openai-completions", credentials: ["apiKey"] } });
    expect(await entries("model-bindings.save")).toEqual([expect.objectContaining({ detail: expect.objectContaining({ bindings: ["some-agent"] }) })]);

    const all = await admin.get<{ items: AuditEntry[] }>("/governance/audit?limit=200");
    expect(all.raw).not.toContain(API_KEY);
  });

  it("audits the commit identity and role changes", async () => {
    expect((await admin.request("PUT", "/admin/settings/commit-identity", { body: { name: "Audit Bot", email: "audit-bot@example.com" } })).status).toBe(200);
    expect((await admin.request("POST", "/admin/roles", { body: { id: "auditor", name: "Auditor" } })).status).toBe(201);
    expect((await admin.request("PUT", "/admin/roles/auditor/permissions", { body: { permissions: ["projects.manage"] } })).status).toBe(200);

    expect(await entries("commit-identity.update")).toEqual([
      expect.objectContaining({ detail: expect.objectContaining({ name: "Audit Bot", email: "audit-bot@example.com" }) }),
    ]);
    expect(await entries("role.create")).toEqual([expect.objectContaining({ subject: "auditor" })]);
    expect(await entries("role.permissions")).toEqual([
      expect.objectContaining({ subject: "auditor", detail: expect.objectContaining({ added: ["projects.manage"], removed: [] }) }),
    ]);
  });
});
