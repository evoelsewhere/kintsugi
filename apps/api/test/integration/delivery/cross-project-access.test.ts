// The lists that span projects show a user only what Project Access lets them read (ADR-0099 decision 4): the runs
// overview, the document writes overview and, per project, the document writes of one project, which sits under
// admin/projects and so outside the scan of the projects/:id controllers.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, currentUserId, grantProjectAccess, memberClient, startTestApp, type Client, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Listed {
  items: Array<{ id: string; projectId: string }>;
  total: number;
}

describe.skipIf(!hasDatabase)("cross-project lists and Project Access (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let reader: Client;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('github', 'github', 'GitHub', 'https://github.example.invalid', 'none')");
    for (const id of ["open-docs", "hidden-docs"]) {
      await app.db.query("insert into admin.git_repository (id, server_id, url) values ($1, 'github', $2)", [id, `https://github.example.invalid/org/${id}.git`]);
    }
    for (const [id, repository] of [["open", "open-docs"], ["hidden", "hidden-docs"]] as const) {
      expect((await admin.request("POST", "/admin/projects", { body: { id, name: id, documentRepositoryId: repository } })).status).toBe(201);
      expect((await admin.request("POST", `/admin/projects/${id}/applications`, { body: { id: "web", name: "Web" } })).status).toBe(201);
      await app.db.query("insert into workflow.document_write (id, project_id, kind, message, status) values ($1, $2, 'job-output', $3, 'committed')", [`w-${id}`, id, `Secret page of ${id}`]);
      await app.db.query("insert into workflow.job_run (id, project_id, application_id, kind, name, status) values ($1, $2, 'web', 'stage', 'assess', 'succeeded')", [`run-${id}`, id]);
    }
    reader = (await memberClient(app, admin, "cross-project-reader", ["user"], ["open"])).client;
  });
  afterAll(async () => {
    await app?.close();
  });

  it("lists only the runs and the document writes of the projects the user holds Project Access on", async () => {
    const runs = await reader.get<Listed>("/job-runs");
    expect(runs.status).toBe(200);
    expect(runs.body.data?.items.map((run) => run.projectId)).toEqual(["open"]);
    expect(runs.body.data?.total).toBe(1);
    const writes = await reader.get<Listed>("/document-writes");
    expect(writes.status).toBe(200);
    expect(writes.body.data?.items.map((write) => write.projectId)).toEqual(["open"]);
    expect(writes.body.data?.total).toBe(1);
    expect(writes.raw).not.toContain("Secret page of hidden");
  });

  it("shows nothing of a project asked for by name without access", async () => {
    for (const path of ["/job-runs?projectId=hidden", "/document-writes?projectId=hidden"]) {
      const response = await reader.get<Listed>(path);
      expect(response.status, path).toBe(200);
      expect(response.body.data, path).toMatchObject({ items: [], total: 0 });
    }
  });

  it("shows a user without any grant empty lists, and an administrator what they were granted", async () => {
    const { client: stranger } = await memberClient(app, admin, "cross-project-stranger", ["user"]);
    expect((await stranger.get<Listed>("/job-runs")).body.data).toMatchObject({ items: [], total: 0 });
    expect((await stranger.get<Listed>("/document-writes")).body.data).toMatchObject({ items: [], total: 0 });
    expect((await admin.get<Listed>("/job-runs")).body.data?.total).toBe(0);
    await grantProjectAccess(admin, "hidden", await currentUserId(admin));
    expect((await admin.get<Listed>("/job-runs")).body.data?.items.map((run) => run.projectId)).toEqual(["hidden"]);
    expect((await admin.get<Listed>("/document-writes")).body.data?.items.map((write) => write.projectId)).toEqual(["hidden"]);
  });

  it("answers 403 to the document writes of one project without Project Access, and lists them with it", async () => {
    const denied = await reader.get("/admin/projects/hidden/document-writes");
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe("Project Access is required");
    expect(denied.raw).not.toContain("Secret page of hidden");
    const allowed = await reader.get<Listed>("/admin/projects/open/document-writes");
    expect(allowed.status).toBe(200);
    expect(allowed.body.data?.items.map((write) => write.id)).toEqual(["w-open"]);
  });
});
