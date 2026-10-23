import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";
import { MemberContextProbeModule } from "../support/member-context-probe.js";
import { loadEnv } from "../../src/common/config/env.js";

interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  connectionId: string;
  projectIds: string[];
}

interface ConnectionMetadata {
  id: string;
  clientName: string;
  projectIds: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

async function setupProject(app: TestApp, id: string): Promise<void> {
  await app.db.query("insert into admin.project (id, name) values ($1, $1)", [id]);
}

async function enableMemberRead(app: TestApp, roleId = "admin"): Promise<void> {
  await app.db.query("insert into core.role_permission (role_id, permission_code) values ($1, 'member.read') on conflict do nothing", [roleId]);
}

async function grantProjectAccess(admin: Client, projectId: string, userId: string): Promise<void> {
  const response = await admin.request("PUT", `/admin/project-access/${projectId}/${userId}`, { body: {} });
  expect(response.status).toBe(204);
}

async function beginAuthorization(client: Client, projectId: string, clientName = "codex", redirectUri = "http://127.0.0.1:43127/oauth/callback") {
  const verifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(32).toString("base64url");
  const authorization = await client.request<{ redirectTo: string }>("POST", "/auth/coding-agent/authorize", {
    body: { projectId, clientName, redirectUri, state, codeChallenge, codeChallengeMethod: "S256" },
  });
  const callback = authorization.body.data?.redirectTo === undefined ? undefined : new URL(authorization.body.data.redirectTo);
  return {
    authorization,
    code: callback?.searchParams.get("code") ?? undefined,
    callbackState: callback?.searchParams.get("state") ?? undefined,
    state,
    verifier,
    redirectUri,
  };
}

async function exchange(app: TestApp, body: unknown) {
  return new Client(app).request<OAuthTokenResponse>("POST", "/auth/coding-agent/token", {
    body,
    csrf: false,
    headers: { "x-kintsugi-csrf": "1" },
  });
}

async function probe(app: TestApp, token: string, projectId: string) {
  return new Client(app).request("GET", `/__test/member-context?projectId=${encodeURIComponent(projectId)}`, {
    csrf: false,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe.skipIf(!hasDatabase)("Coding Agent Workflow browser authorization (integration)", () => {
  let app: TestApp;
  let admin: Client;

  beforeAll(async () => {
    app = await startTestApp([MemberContextProbeModule]);
    admin = await adminClient(app);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("AUTH-OAUTH-00 returns the configured canonical installation URL, ignoring Host", async () => {
    const response = await admin.request<{ baseUrl: string }>("GET", "/auth/coding-agent/installation", {
      headers: { host: "attacker.example" },
    });
    expect(response.status).toBe(200);
    expect(response.body.data?.baseUrl).toBe(loadEnv().publicUrl);
    expect(response.body.data?.baseUrl).not.toContain("attacker.example");
  });

  it("AUTH-OAUTH-01 exchanges one project-scoped PKCE code and stores only hashes", async () => {
    await enableMemberRead(app);
    await setupProject(app, "oauth-one");
    const member = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    await grantProjectAccess(admin, "oauth-one", member.id);

    const started = await beginAuthorization(admin, "oauth-one");
    expect(started.authorization.status).toBe(201);
    expect(started.callbackState).toBeTruthy();
    expect(started.callbackState).toBe(started.state);
    expect(started.code).toMatch(/^knt_ac_[A-Za-z0-9_-]{43}$/);

    const issued = await exchange(app, {
      grantType: "authorization_code",
      code: started.code,
      codeVerifier: started.verifier,
      redirectUri: started.redirectUri,
    });
    expect(issued.status).toBe(200);
    expect(issued.body.data).toMatchObject({ expiresIn: 300, projectIds: ["oauth-one"] });
    expect(issued.body.data?.accessToken).toMatch(/^knt_caw_[A-Za-z0-9_-]{43}$/);
    expect(issued.body.data?.refreshToken).toMatch(/^knt_crt_[A-Za-z0-9_-]{43}$/);

    const storedAccess = await app.db.query<{ token_hash: string; connection_id: string | null }>(
      "select token_hash, connection_id from core.member_token where token_hash = $1",
      [hash(issued.body.data!.accessToken)],
    );
    expect(storedAccess.rows[0]).toMatchObject({ token_hash: hash(issued.body.data!.accessToken), connection_id: issued.body.data!.connectionId });
    const storedRefresh = await app.db.query<{ token_hash: string }>(
      "select token_hash from core.member_connection_refresh_token where token_hash = $1",
      [hash(issued.body.data!.refreshToken)],
    );
    expect(storedRefresh.rows[0]?.token_hash).toBe(hash(issued.body.data!.refreshToken));
    expect(issued.body.data?.accessToken).not.toBe(storedAccess.rows[0]?.token_hash);
    expect(issued.body.data?.refreshToken).not.toBe(storedRefresh.rows[0]?.token_hash);

    expect((await probe(app, issued.body.data!.accessToken, "oauth-one")).status).toBe(200);
    const replay = await exchange(app, {
      grantType: "authorization_code",
      code: started.code,
      codeVerifier: started.verifier,
      redirectUri: started.redirectUri,
    });
    expect(replay.status).toBe(400);
    const connections = await app.db.query<{ count: string }>("select count(*)::text as count from core.member_connection where user_id = $1 and id = $2", [member.id, issued.body.data!.connectionId]);
    expect(connections.rows[0]?.count).toBe("1");
  });

  it("AUTH-OAUTH-02 consumes invalid, mismatched and expired authorization codes without creating connections", async () => {
    await enableMemberRead(app);
    await setupProject(app, "oauth-two");
    const member = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    await grantProjectAccess(admin, "oauth-two", member.id);

    const wrongVerifier = await beginAuthorization(admin, "oauth-two", "claude-code");
    const wrongVerifierResult = await exchange(app, {
      grantType: "authorization_code",
      code: wrongVerifier.code,
      codeVerifier: randomBytes(32).toString("base64url"),
      redirectUri: wrongVerifier.redirectUri,
    });
    expect(wrongVerifierResult.status).toBe(400);

    const wrongRedirect = await beginAuthorization(admin, "oauth-two", "claude-code", "http://127.0.0.1:43128/oauth/callback");
    const wrongRedirectResult = await exchange(app, {
      grantType: "authorization_code",
      code: wrongRedirect.code,
      codeVerifier: wrongRedirect.verifier,
      redirectUri: "http://127.0.0.1:43129/oauth/callback",
    });
    expect(wrongRedirectResult.status).toBe(400);

    const expired = await beginAuthorization(admin, "oauth-two", "claude-code", "http://127.0.0.1:43130/oauth/callback");
    await app.db.query("update core.member_authorization_code set created_at = now() - interval '10 minutes', expires_at = now() - interval '1 second' where code_hash = $1", [hash(expired.code!)]);
    const expiredResult = await exchange(app, {
      grantType: "authorization_code",
      code: expired.code,
      codeVerifier: expired.verifier,
      redirectUri: expired.redirectUri,
    });
    expect(expiredResult.status).toBe(400);

    const connections = await app.db.query<{ count: string }>(
      "select count(*)::text as count from core.member_connection c join core.member_connection_project cp on cp.connection_id = c.id where c.user_id = $1 and c.client_name = 'claude-code' and cp.project_id = 'oauth-two'",
      [member.id],
    );
    expect(connections.rows[0]?.count).toBe("0");
  });

  it("AUTH-OAUTH-03 rotates refresh credentials and revokes the connection on any replay", async () => {
    await enableMemberRead(app);
    await setupProject(app, "oauth-three");
    const member = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    await grantProjectAccess(admin, "oauth-three", member.id);
    const started = await beginAuthorization(admin, "oauth-three");
    const first = await exchange(app, { grantType: "authorization_code", code: started.code, codeVerifier: started.verifier, redirectUri: started.redirectUri });
    expect(first.status).toBe(200);

    const rotated = await exchange(app, { grantType: "refresh_token", refreshToken: first.body.data!.refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data?.connectionId).toBe(first.body.data?.connectionId);
    expect(rotated.body.data?.refreshToken).not.toBe(first.body.data?.refreshToken);
    expect((await probe(app, rotated.body.data!.accessToken, "oauth-three")).status).toBe(200);

    const replay = await exchange(app, { grantType: "refresh_token", refreshToken: first.body.data!.refreshToken });
    expect(replay.status).toBe(400);
    expect((await probe(app, rotated.body.data!.accessToken, "oauth-three")).status).toBe(401);
    const connection = await app.db.query<{ revoked_at: Date | null }>("select revoked_at from core.member_connection where id = $1", [first.body.data!.connectionId]);
    expect(connection.rows[0]?.revoked_at).not.toBeNull();
  });

  it("AUTH-OAUTH-07 revokes the current connection using its refresh credential", async () => {
    await enableMemberRead(app);
    await setupProject(app, "oauth-revoke");
    const member = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    await grantProjectAccess(admin, "oauth-revoke", member.id);
    const started = await beginAuthorization(admin, "oauth-revoke");
    const issued = await exchange(app, { grantType: "authorization_code", code: started.code, codeVerifier: started.verifier, redirectUri: started.redirectUri });
    expect(issued.status).toBe(200);

    const revoked = await new Client(app).request("POST", "/auth/coding-agent/revoke", {
      body: { refreshToken: issued.body.data!.refreshToken },
      csrf: false,
      headers: { "x-kintsugi-csrf": "1" },
    });
    expect(revoked.status).toBe(204);
    expect((await probe(app, issued.body.data!.accessToken, "oauth-revoke")).status).toBe(401);
    expect((await exchange(app, { grantType: "refresh_token", refreshToken: issued.body.data!.refreshToken })).status).toBe(400);
    const unknown = await new Client(app).request("POST", "/auth/coding-agent/revoke", {
      body: { refreshToken: "knt_crt_" + "a".repeat(43) },
      csrf: false,
      headers: { "x-kintsugi-csrf": "1" },
    });
    expect(unknown.status).toBe(204);

    const connection = await app.db.query<{ revoked_at: Date | null }>("select revoked_at from core.member_connection where id = $1", [issued.body.data!.connectionId]);
    expect(connection.rows[0]?.revoked_at).not.toBeNull();
  });

  it("AUTH-OAUTH-04 keeps the connection project scope fixed and enforces live Project Access", async () => {
    await enableMemberRead(app);
    await setupProject(app, "oauth-four-a");
    await setupProject(app, "oauth-four-b");
    const member = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    await grantProjectAccess(admin, "oauth-four-a", member.id);
    const started = await beginAuthorization(admin, "oauth-four-a");
    const issued = await exchange(app, { grantType: "authorization_code", code: started.code, codeVerifier: started.verifier, redirectUri: started.redirectUri });
    expect(issued.status).toBe(200);
    expect((await probe(app, issued.body.data!.accessToken, "oauth-four-a")).status).toBe(200);

    await grantProjectAccess(admin, "oauth-four-b", member.id);
    expect((await probe(app, issued.body.data!.accessToken, "oauth-four-b")).status).toBe(403);
    await admin.request("DELETE", `/admin/project-access/oauth-four-a/${member.id}`);
    expect((await probe(app, issued.body.data!.accessToken, "oauth-four-a")).status).toBe(403);
  });

  it("AUTH-OAUTH-05 lists safe connection metadata and restricts revocation by owner or security.manage", async () => {
    await enableMemberRead(app);
    await setupProject(app, "oauth-five");
    const member = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    await grantProjectAccess(admin, "oauth-five", member.id);
    const started = await beginAuthorization(admin, "oauth-five", "claude-code");
    const issued = await exchange(app, { grantType: "authorization_code", code: started.code, codeVerifier: started.verifier, redirectUri: started.redirectUri });
    expect(issued.status).toBe(200);

    const own = await admin.get<{ items: ConnectionMetadata[] }>("/auth/member-connections");
    expect(own.status).toBe(200);
    expect(own.body.data?.items.some((item) => item.id === issued.body.data!.connectionId && item.clientName === "claude-code" && item.projectIds.includes("oauth-five"))).toBe(true);
    expect(own.raw).not.toContain(issued.body.data!.accessToken);
    expect(own.raw).not.toContain(issued.body.data!.refreshToken);

    const outsider = await memberClient(app, admin, "oauth-five-outsider", ["user"]);
    const forbidden = await outsider.client.request("DELETE", `/auth/member-connections/${issued.body.data!.connectionId}`);
    expect(forbidden.status).toBe(404);
    expect((await outsider.client.get("/admin/coding-agent-connections")).status).toBe(403);

    const all = await admin.get<{ items: ConnectionMetadata[] }>("/admin/coding-agent-connections");
    expect(all.status).toBe(200);
    expect(all.body.data?.items.some((item) => item.id === issued.body.data!.connectionId)).toBe(true);
    expect((await admin.request("DELETE", `/admin/coding-agent-connections/${issued.body.data!.connectionId}`)).status).toBe(204);
    expect((await probe(app, issued.body.data!.accessToken, "oauth-five")).status).toBe(401);
  });

  it("AUTH-OAUTH-06 requires current read permission and Project Access before consent", async () => {
    await enableMemberRead(app);
    await setupProject(app, "oauth-six");
    const member = (await admin.get<{ id: string }>("/auth/me")).body.data!;
    const denied = await beginAuthorization(admin, "oauth-six");
    expect(denied.authorization.status).toBe(403);
    expect(denied.authorization.raw).not.toContain("knt_ac_");
    await grantProjectAccess(admin, "oauth-six", member.id);
    await app.db.query("delete from core.role_permission where role_id = 'admin' and permission_code = 'member.read'");
    const noPermission = await beginAuthorization(admin, "oauth-six");
    expect(noPermission.authorization.status).toBe(403);
    expect(noPermission.authorization.raw).not.toContain("knt_ac_");
  });
});
