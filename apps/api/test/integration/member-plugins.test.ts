// Member plugins (ADR-0069): the grants per project, the download of a granted plugin through the member API,
// the one write a plugin has (the activity record) and what Monitoring shows of it.

import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../../src/common/domain/ids.js";
import { hashToken } from "../../src/common/security/token-hash.js";
import { MEMBER_TOKEN_PREFIX } from "../../src/modules/core/auth/application/member-token.service.js";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

interface Bundle { name: string; version: string; contentHash: string; files: Array<{ path: string; content: string; sha256: string }> }
interface Activity { items: Array<{ kind: string; pluginName?: string; username: string; summary: string }>; total: number }
interface Usage { members: Array<{ username: string; events: number; kinds: Record<string, number>; plugins: Record<string, number> }> }

async function issue(app: TestApp, userId: string, projectIds: string[]): Promise<string> {
  const token = MEMBER_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const id = newId();
  await app.db.query("insert into core.member_token (id, user_id, name, token_hash, expires_at) values ($1, $2, 'test', $3, $4)", [id, userId, hashToken(token), new Date(Date.now() + 60_000)]);
  await app.db.query("insert into core.member_token_project (token_id, project_id) select $1, project_id from unnest($2::text[]) as project_id", [id, projectIds]);
  return token;
}

const bearer = (token: string) => ({ csrf: false, headers: { authorization: `Bearer ${token}` } });

describe.skipIf(!hasDatabase)("member plugins (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let adminId: string;
  let token: string;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into core.role_permission (role_id, permission_code) values ('admin', 'member.read') on conflict do nothing");
    await app.db.query("insert into admin.project (id, name) values ('plug-one', 'Plug one'), ('plug-two', 'Plug two')");
    adminId = (await admin.get<{ id: string }>("/auth/me")).body.data!.id;
    for (const project of ["plug-one", "plug-two"]) expect((await admin.request("PUT", `/admin/project-access/${project}/${adminId}`, { body: {} })).status).toBe(204);
    token = await issue(app, adminId, ["plug-one"]);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("lists nothing until a member plugin is granted, and grants only member plugins", async () => {
    const empty = await new Client(app).request<{ items: unknown[] }>("GET", "/member/v1/plugins?projectId=plug-one", bearer(token));
    expect(empty.status).toBe(200);
    expect(empty.body.data?.items).toEqual([]);

    expect((await admin.request("PUT", "/admin/plugin-access/plug-one/modernize/*", { body: {} })).status).toBe(400);
    expect((await admin.request("PUT", "/admin/plugin-access/plug-one/no-such-plugin/*", { body: {} })).status).toBe(404);
    expect((await admin.request("PUT", "/admin/plugin-access/plug-one/context/no-such-user", { body: {} })).status).toBe(404);
    expect((await admin.request("PUT", "/admin/plugin-access/plug-one/context/*", { body: {} })).status).toBe(204);

    const grants = await admin.get<{ items: Array<{ pluginName: string; userId: string }> }>("/admin/plugin-access/plug-one");
    expect(grants.body.data?.items).toEqual([expect.objectContaining({ pluginName: "context", userId: "*" })]);
    const listed = await new Client(app).request<{ items: Array<{ name: string }> }>("GET", "/member/v1/plugins?projectId=plug-one", bearer(token));
    expect(listed.body.data?.items.map((item) => item.name)).toEqual(["context"]);
    // The grant is per project.
    const other = await new Client(app).request("GET", "/member/v1/plugins?projectId=plug-two", bearer(await issue(app, adminId, ["plug-two"])));
    expect((other.body.data as { items: unknown[] }).items).toEqual([]);
  });

  it("downloads a granted plugin with verifiable hashes and nothing that runs code", async () => {
    const response = await new Client(app).request<Bundle>("GET", "/member/v1/plugins/context?projectId=plug-one", bearer(token));
    expect(response.status).toBe(200);
    const bundle = response.body.data!;
    expect(bundle.name).toBe("context");
    expect(bundle.files.map((file) => file.path)).toContain("skills/kintsugi-context/SKILL.md");
    expect(bundle.files.every((file) => /^(skills\/|agents\/|commands\/)/.test(file.path))).toBe(true);
    for (const file of bundle.files) expect(createHash("sha256").update(file.content).digest("hex")).toBe(file.sha256);
    const expected = createHash("sha256").update(bundle.files.map((file) => `${file.path}:${file.sha256}`).join(";")).digest("hex");
    expect(bundle.contentHash).toBe(`sha256:${expected}`);

    // A runtime plugin is never distributed, and a plugin that is not granted is refused.
    expect((await new Client(app).request("GET", "/member/v1/plugins/modernize?projectId=plug-one", bearer(token))).status).toBe(403);
    expect((await new Client(app).request("GET", "/member/v1/plugins/context?projectId=plug-two", bearer(token))).status).toBe(403);
  });

  it("records what a plugin did within bounds and keeps Kintsugi's own kinds to itself", async () => {
    const client = new Client(app);
    const recorded = await client.request<{ id: string }>("POST", "/member/v1/activity", { ...bearer(token), body: { projectId: "plug-one", kind: "result", pluginName: "context", harness: "claude-code", summary: "Reviewed the standards", detail: { documents: 3, ok: true } } });
    expect(recorded.status).toBe(201);
    expect(recorded.body.data?.id).toBeTruthy();

    const post = (body: unknown) => client.request("POST", "/member/v1/activity", { ...bearer(token), body });
    expect((await post({ projectId: "plug-one", kind: "plugin.download" })).status).toBe(400);
    expect((await post({ projectId: "plug-one", kind: "Bad Kind" })).status).toBe(400);
    expect((await post({ projectId: "plug-one", kind: "note", summary: "x".repeat(501) })).status).toBe(400);
    expect((await post({ projectId: "plug-one", kind: "note", pluginName: "modernize" })).status).toBe(403);
    // The token covers plug-one only.
    expect((await post({ projectId: "plug-two", kind: "note" })).status).toBe(403);
    // A write needs a token or a session: an anonymous request is refused, with or without the CSRF header.
    expect((await new Client(app).request("POST", "/member/v1/activity", { csrf: false, body: { projectId: "plug-one", kind: "note" } })).status).toBe(403);
    expect((await new Client(app).request("POST", "/member/v1/activity", { body: { projectId: "plug-one", kind: "note" } })).status).toBe(401);
    // A member token reaches only the member routes: it cannot change an administration setting.
    expect((await client.request("PUT", `/admin/project-access/plug-two/${adminId}`, { ...bearer(token), body: {} })).status).toBe(403);
  });

  it("shows the activity per member and plugin to those who may view it", async () => {
    await new Client(app).request("GET", "/member/v1/documents/tree?projectId=plug-one", bearer(token));
    const list = await admin.get<Activity>("/monitoring/member-activity?projectId=plug-one");
    expect(list.status).toBe(200);
    const kinds = list.body.data!.items.map((item) => item.kind);
    expect(kinds).toEqual(expect.arrayContaining(["plugin.download", "result"]));
    expect(list.body.data!.items.find((item) => item.kind === "result")).toMatchObject({ pluginName: "context", username: "admin", summary: "Reviewed the standards" });

    const filtered = await admin.get<Activity>("/monitoring/member-activity?projectId=plug-one&kind=result");
    expect(filtered.body.data!.items.every((item) => item.kind === "result")).toBe(true);

    const summary = await admin.get<Usage>("/monitoring/member-activity/summary?projectId=plug-one");
    const me = summary.body.data!.members.find((member) => member.username === "admin")!;
    expect(me.kinds["result"]).toBeGreaterThanOrEqual(1);
    expect(me.plugins["context"]).toBeGreaterThanOrEqual(2);

    const bob = await memberClient(app, admin, "plugin-bob", ["user"]);
    expect((await bob.client.get("/monitoring/member-activity?projectId=plug-one")).status).toBe(403);
  });

  it("withdraws a grant", async () => {
    expect((await admin.request("DELETE", "/admin/plugin-access/plug-one/context/*", { body: {} })).status).toBe(204);
    expect((await new Client(app).request("GET", "/member/v1/plugins/context?projectId=plug-one", bearer(token))).status).toBe(403);
    const after = await admin.get<{ items: unknown[] }>("/admin/plugin-access/plug-one");
    expect(after.body.data?.items).toEqual([]);
  });
});
