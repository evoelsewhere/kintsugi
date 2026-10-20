import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";
import { MemberContextProbeModule } from "../support/member-context-probe.js";

type TokenMetadata = { id: string; name: string; projectIds: string[]; expiresAt: string };
type IssuedToken = { token: string; metadata: TokenMetadata };

async function setupProject(app: TestApp, id: string): Promise<void> {
  await app.db.query("insert into admin.project (id, name) values ($1, $1)", [id]);
}

async function enableAdminMemberRead(app: TestApp): Promise<void> {
  await app.db.query("insert into core.role_permission (role_id, permission_code) values ('admin', 'member.read') on conflict do nothing");
}

async function grantProjectAccess(admin: Client, projectId: string, userId: string): Promise<void> {
  const response = await admin.request("PUT", `/admin/project-access/${projectId}/${userId}`, { body: {} });
  expect(response.status).toBe(204);
}

async function issue(admin: Client, projectIds: string[], name = "coding agent"): Promise<IssuedToken> {
  const response = await admin.request<IssuedToken>("POST", "/auth/member-tokens", {
    body: { name, projectIds, expiresAt: new Date(Date.now() + 60_000).toISOString() },
  });
  expect(response.status).toBe(201);
  return response.body.data!;
}

async function probe(app: TestApp, token: string, projectId: string) {
  return new Client(app).request("GET", `/__test/member-context?projectId=${encodeURIComponent(projectId)}`, {
    csrf: false,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe.skipIf(!hasDatabase)("Coding Agent Workflow tokens (integration)", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await startTestApp([MemberContextProbeModule]);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("AUTH-01 issues an opaque token once and stores only its hash", async () => {
    const admin = await adminClient(app);
    await enableAdminMemberRead(app);
    await setupProject(app, "auth-one");
    const me = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    await grantProjectAccess(admin, "auth-one", me.id);

    const issued = await issue(admin, ["auth-one"]);
    expect(issued.token).toMatch(/^knt_[A-Za-z0-9_-]{40,}$/);
    expect(issued.metadata.projectIds).toEqual(["auth-one"]);
    expect(issued.metadata).not.toHaveProperty("token");

    const stored = await app.db.query<{ token_hash: string }>("select token_hash from core.member_token where id = $1", [issued.metadata.id]);
    expect(stored.rows[0]?.token_hash).not.toBe(issued.token);
    expect(stored.rows[0]?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    const audit = await app.db.query<{ detail: string }>("select detail::text as detail from governance.audit_event where action = 'member-token.issue' and subject = $1", [issued.metadata.id]);
    expect(audit.rows[0]?.detail).not.toContain(issued.token);

    const listed = await admin.get<{ items: TokenMetadata[] }>("/auth/member-tokens");
    expect(listed.status).toBe(200);
    expect(listed.raw).not.toContain(issued.token);
    expect(listed.body.data?.items).toHaveLength(1);
    expect((await probe(app, issued.token, "auth-one")).status).toBe(200);
  });

  it("AUTH-02 rejects revoked, expired and disabled-user tokens on every scoped call", async () => {
    const admin = await adminClient(app);
    await enableAdminMemberRead(app);
    await setupProject(app, "auth-two");
    const me = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    await grantProjectAccess(admin, "auth-two", me.id);

    const revoked = await issue(admin, ["auth-two"], "revoked");
    expect((await admin.request("DELETE", `/auth/member-tokens/${revoked.metadata.id}`)).status).toBe(204);
    expect((await probe(app, revoked.token, "auth-two")).status).toBe(401);

    const expired = await issue(admin, ["auth-two"], "expired");
    await app.db.query("update core.member_token set created_at = now() - interval '2 seconds', expires_at = now() - interval '1 second' where id = $1", [expired.metadata.id]);
    expect((await probe(app, expired.token, "auth-two")).status).toBe(401);

    await app.db.query("insert into core.role_permission (role_id, permission_code) values ('user', 'member.read'), ('user', 'tokens.manage-own') on conflict do nothing");
    const { client: disabledClient, id: disabledUserId } = await memberClient(app, admin, "auth-disabled", ["user"]);
    await grantProjectAccess(admin, "auth-two", disabledUserId);
    const disabled = await issue(disabledClient, ["auth-two"], "disabled");
    await app.db.query("update core.app_user set enabled = false where id = $1", [disabledUserId]);
    const response = await probe(app, disabled.token, "auth-two");
    expect(response.status).toBe(401);
    expect(response.raw).not.toContain("PRIVATE_CONTEXT_MARKER");
  });

  it("AUTH-03 intersects token scope with current Project Access and revocation takes effect immediately", async () => {
    const admin = await adminClient(app);
    await enableAdminMemberRead(app);
    await setupProject(app, "auth-three-a");
    await setupProject(app, "auth-three-b");
    const me = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    await grantProjectAccess(admin, "auth-three-a", me.id);
    await grantProjectAccess(admin, "auth-three-b", me.id);
    const issued = await issue(admin, ["auth-three-a"]);

    expect((await probe(app, issued.token, "auth-three-a")).status).toBe(200);
    await app.db.query("delete from core.role_permission where role_id = 'admin' and permission_code = 'member.read'");
    expect((await probe(app, issued.token, "auth-three-a")).status).toBe(403);
    await app.db.query("insert into core.role_permission (role_id, permission_code) values ('admin', 'member.read') on conflict do nothing");
    const outOfScope = await probe(app, issued.token, "auth-three-b");
    expect(outOfScope.status).toBe(403);
    expect(outOfScope.raw).not.toContain("PRIVATE_CONTEXT_MARKER");

    expect((await admin.request("DELETE", `/admin/project-access/auth-three-a/${me.id}`)).status).toBe(204);
    const revokedAccess = await probe(app, issued.token, "auth-three-a");
    expect(revokedAccess.status).toBe(403);
    expect(revokedAccess.raw).not.toContain("PRIVATE_CONTEXT_MARKER");
  });

  it("AUTH-04 does not reveal private markers for guessed project context", async () => {
    const admin = await adminClient(app);
    await enableAdminMemberRead(app);
    await setupProject(app, "auth-four");
    const me = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    await grantProjectAccess(admin, "auth-four", me.id);
    const issued = await issue(admin, ["auth-four"]);

    const unknown = await probe(app, issued.token, "guessed-project");
    expect(unknown.status).toBe(403);
    expect(unknown.raw).not.toContain("PRIVATE_CONTEXT_MARKER");
    expect(me.id).toBeTruthy();
  });

  it("AUTH-05 confines even an administrator token to explicitly marked reads", async () => {
    const admin = await adminClient(app);
    await enableAdminMemberRead(app);
    await setupProject(app, "auth-five");
    const me = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    await grantProjectAccess(admin, "auth-five", me.id);
    const issued = await issue(admin, ["auth-five"]);
    const bearer = { authorization: `Bearer ${issued.token}` };

    for (const [method, path, body] of [
      ["POST", "/admin/roles", { id: "denied-role", name: "denied" }],
      ["POST", "/governance/gates", { projectId: "auth-five", marker: "PRIVATE_CONTEXT_MARKER" }],
    ] as const) {
      const denied = await new Client(app).request(method, path, { body, csrf: false, headers: bearer });
      expect(denied.status).toBe(403);
      expect(denied.raw).not.toContain("PRIVATE_CONTEXT_MARKER");
    }

    for (const path of ["/admin/users", "/admin/roles", "/admin/projects", "/governance/gates"]) {
      const denied = await new Client(app).request("GET", path, { csrf: false, headers: bearer });
      expect(denied.status).toBe(403);
      expect(denied.raw).not.toContain("PRIVATE_CONTEXT_MARKER");
    }

    const cookie = await admin.get("/admin/roles");
    expect(cookie.status).toBe(200);
    expect((await admin.request("POST", "/admin/roles", { body: { id: "cookie-role", name: "cookie" } })).status).toBe(201);
  });

  it("AUTH-06 does not infer Project Access from the administrator's assignment or installation role", async () => {
    const admin = await adminClient(app);
    await setupProject(app, "auth-six");
    const response = await admin.request("POST", "/auth/member-tokens", {
      body: { name: "ungranted", projectIds: ["auth-six"], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(response.status).toBe(403);
    expect(response.raw).not.toContain("knt_");
  });

  it("AUTH-08 denies token and Project Access mutations through a read token", async () => {
    const admin = await adminClient(app);
    await enableAdminMemberRead(app);
    await setupProject(app, "auth-seven");
    const me = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    await grantProjectAccess(admin, "auth-seven", me.id);
    const issued = await issue(admin, ["auth-seven"]);
    const headers = { authorization: `Bearer ${issued.token}` };

    expect((await new Client(app).get("/__test/member-context?projectId=auth-seven")).status).toBe(401);
    expect((await new Client(app).request("GET", "/auth/member-tokens", { csrf: false, headers })).status).toBe(403);
    expect((await new Client(app).request("DELETE", `/auth/member-tokens/${issued.metadata.id}`, { csrf: false, headers })).status).toBe(403);
    expect((await new Client(app).request("PUT", `/admin/project-access/auth-seven/${me.id}`, { body: {}, csrf: false, headers })).status).toBe(403);
  });
});