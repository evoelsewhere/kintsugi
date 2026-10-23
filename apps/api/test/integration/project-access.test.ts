import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { adminClient, memberClient, startTestApp, subRole, type TestApp } from "../support/app.js";

describe.skipIf(!hasDatabase)("Project Access (integration)", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it("grants and revokes project scope explicitly", async () => {
    const admin = await adminClient(app);
    const { client: member, id: userId } = await memberClient(app, admin, "project-access-reader", ["user"]);
    await app.db.query("insert into admin.project (id, name) values ('project-access-a', 'Project Access A')");

    const granted = await admin.request("PUT", `/admin/project-access/project-access-a/${userId}`, { body: {} });
    expect(granted.status).toBe(204);
    const listed = await admin.get<{ items: Array<{ projectId: string; userId: string }> }>("/admin/project-access/project-access-a");
    expect(listed.status).toBe(200);
    expect(listed.body.data?.items).toContainEqual(expect.objectContaining({ projectId: "project-access-a", userId }));

    const removal = await admin.request("DELETE", `/admin/project-access/project-access-a/${userId}`);
    expect(removal.status).toBe(204);
    const afterRemoval = await admin.get<{ items: unknown[] }>("/admin/project-access/project-access-a");
    expect(afterRemoval.body.data?.items).toHaveLength(0);
    expect(member.cookie).toBeTruthy();
  });

  it("AUTH-06 rejects grant administration without project.access.manage", async () => {
    const admin = await adminClient(app);
    await app.db.query("insert into admin.project (id, name) values ('project-access-b', 'Project Access B')");
    await subRole(admin, "project-reader-only", []);
    const { client } = await memberClient(app, admin, "project-access-unprivileged", ["user", "project-reader-only"]);

    const response = await client.request("PUT", "/admin/project-access/project-access-b/someone", { body: {} });
    expect(response.status).toBe(403);
  });
});