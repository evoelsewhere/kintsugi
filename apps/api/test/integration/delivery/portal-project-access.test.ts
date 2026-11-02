// A signed-in user without Project Access gets 403 on every project route of the portal (documents, Brain, catalog,
// design, build, runs: ADR-0099 decision 4), an administrator included; with a grant the routes answer as before. The
// controllers are found by scanning the sources for the prefix projects/:id and their routes come from their own
// metadata, so a controller or route added later is covered without editing this file.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, memberClient, startTestApp, type Client, type TestApp } from "../../support/app.js";
import { controllerRoutes, projectScopedControllers } from "../../support/controller-routes.js";
import { hasDatabase } from "../../support/database.js";

const PROJECT = "portal-access";
const PARAMS: Record<string, string> = { id: PROJECT, appId: "web", stage: "assess" };
const routes = (await projectScopedControllers()).flatMap((controller) => controllerRoutes(controller));
const pathOf = (pattern: string) => `/${pattern.replace(/:(\w+)/g, (_match, name: string) => PARAMS[name] ?? "x")}`;
const cases = routes.map((route) => [`${route.method} ${pathOf(route.path)}`, route] as const);
const send = (client: Client, route: (typeof routes)[number]) => client.request(route.method, pathOf(route.path), route.method === "GET" ? {} : { body: {} });

describe.skipIf(!hasDatabase)("Project Access on the portal's project routes (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let adminId: string;
  let member: Client;
  let memberId: string;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    adminId = (await admin.get<{ id: string }>("/auth/me")).body.data!.id;
    ({ client: member, id: memberId } = await memberClient(app, admin, "portal-access-reader", ["user"]));
    await app.db.query("insert into admin.project (id, name) values ($1, 'Portal Access Secret Project')", [PROJECT]);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("covers every project route", () => {
    expect(routes.length).toBeGreaterThanOrEqual(35);
  });

  it.each(cases)("%s answers 403 to a user without Project Access", async (_name, route) => {
    const response = await send(member, route);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ success: false, statusCode: 403 });
    expect(response.body.data).toBeUndefined();
    expect(response.raw).not.toContain("Portal Access Secret Project");
  });

  it.each(cases)("%s answers 403 to an administrator without a grant", async (_name, route) => {
    const response = await send(admin, route);
    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Project Access is required");
  });

  it("lets the same user through once Project Access is granted, and not after it is revoked", async () => {
    expect((await member.get(`/projects/${PROJECT}/documents/refs`)).status).toBe(403);
    expect((await admin.request("PUT", `/admin/project-access/${PROJECT}/${memberId}`, { body: {} })).status).toBe(204);
    expect((await member.get(`/projects/${PROJECT}/documents/refs`)).status).not.toBe(403);
    expect((await member.get(`/projects/${PROJECT}/brain`)).status).toBe(200);
    expect((await member.get(`/projects/${PROJECT}/job-runs`)).status).toBe(200);
    expect((await admin.request("DELETE", `/admin/project-access/${PROJECT}/${memberId}`)).status).toBe(204);
    expect((await member.get(`/projects/${PROJECT}/documents/refs`)).status).toBe(403);
    expect((await member.get(`/projects/${PROJECT}/brain`)).status).toBe(403);
  });

  it("keeps the answer-a-gap route behind Project Access and documents.resolve", async () => {
    const path = `/projects/${PROJECT}/applications/web/understand/gaps/answer`;
    const { client: reader, id: readerId } = await memberClient(app, admin, "portal-access-gap-reader", ["user"]);
    expect((await admin.request("PUT", `/admin/project-access/${PROJECT}/${readerId}`, { body: {} })).status).toBe(204);
    const withoutPermission = await reader.request("POST", path, { body: {} });
    expect(withoutPermission.status).toBe(403);
    expect(withoutPermission.body.message).toMatch(/documents\.resolve/);
    expect((await admin.request("POST", path, { body: {} })).status).toBe(403);
    expect((await admin.request("PUT", `/admin/project-access/${PROJECT}/${adminId}`, { body: {} })).status).toBe(204);
    expect((await admin.request("POST", path, { body: {} })).status).not.toBe(403);
  });
});
