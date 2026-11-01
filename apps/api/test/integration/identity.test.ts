// Members and roles guard rails, session revocation and password hash upgrades (ADR-0008).

import { randomBytes, scryptSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../../src/common/domain/ids.js";
import { hashToken } from "../../src/common/security/token-hash.js";
import { MEMBER_TOKEN_PREFIX } from "../../src/modules/core/auth/application/member-token.service.js";
import { hasDatabase } from "../support/database.js";
import { ADMIN_USER, Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../support/app.js";

describe.skipIf(!hasDatabase)("identity (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let adminId: string;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    adminId = (await admin.get<{ id: string }>("/auth/me")).body.data!.id;
    // A members manager who is not an admin: members.manage plus read access to roles.
    await subRole(admin, "people-ops", ["members.manage"]);
  });
  afterAll(async () => {
    await app?.close();
  });

  describe("escalation", () => {
    it("a members manager cannot grant roles carrying permissions they lack", async () => {
      const { client } = await memberClient(app, admin, "mgr-grant", ["user", "people-ops"]);
      const created = await client.request("POST", "/admin/users", { body: { username: "victim-a", password: "password-123", roleIds: ["admin"] } });
      expect(created.status).toBe(403);
      const self = await client.get<{ id: string }>("/auth/me");
      const promote = await client.request("PATCH", `/admin/users/${self.body.data!.id}`, { body: { roleIds: ["admin"] } });
      expect(promote.status).toBe(403);
    });

    it("a members manager cannot manage a member with more permissions (no account takeover)", async () => {
      const { client } = await memberClient(app, admin, "mgr-takeover", ["user", "people-ops"]);
      const reset = await client.request("POST", `/admin/users/${adminId}/password`, { body: { password: "taken-over-123" } });
      expect(reset.status).toBe(403);
      const disable = await client.request("PATCH", `/admin/users/${adminId}`, { body: { enabled: false } });
      expect(disable.status).toBe(403);
    });

    it("a role manager cannot grant permissions they do not hold", async () => {
      await subRole(admin, "role-editor", ["roles.manage"]);
      const { client } = await memberClient(app, admin, "role-editor-1", ["user", "role-editor"]);
      const created = await client.request("POST", "/admin/roles", { body: { id: "sneaky", name: "sneaky" } });
      expect(created.status).toBe(201);
      const grant = await client.request("PUT", "/admin/roles/sneaky/permissions", { body: { permissions: ["providers.manage"] } });
      expect(grant.status).toBe(403);
    });

    it("a role manager cannot take away permissions they do not hold, from admin or any other role", async () => {
      await subRole(admin, "role-editor-strip", ["roles.manage"]);
      await subRole(admin, "auditors", ["audit.read", "restricted.read"]);
      const { client } = await memberClient(app, admin, "role-editor-2", ["user", "role-editor-strip"]);
      const before = (await admin.get<{ permissions: string[] }>("/admin/roles/admin")).body.data!.permissions;

      const strip = await client.request("PUT", "/admin/roles/admin/permissions", { body: { permissions: ["members.manage", "roles.manage"] } });
      expect(strip.status).toBe(403);
      expect(strip.raw).toContain("providers.manage");
      const emptied = await client.request("PUT", "/admin/roles/auditors/permissions", { body: { permissions: [] } });
      expect(emptied.status).toBe(403);
      expect(emptied.raw).toContain("audit.read");
      expect((await admin.get<{ permissions: string[] }>("/admin/roles/admin")).body.data!.permissions).toEqual(before);

      // A change that touches only what the role manager holds still goes through.
      expect((await client.request("PUT", "/admin/roles/auditors/permissions", { body: { permissions: ["audit.read", "restricted.read", "roles.manage"] } })).status).toBe(200);
      expect((await client.request("PUT", "/admin/roles/auditors/permissions", { body: { permissions: ["audit.read", "restricted.read"] } })).status).toBe(200);
      // And an admin still edits every role.
      expect((await admin.request("PUT", "/admin/roles/auditors/permissions", { body: { permissions: ["audit.read"] } })).status).toBe(200);
    });

    it("a role manager cannot delete a sub-role that grants permissions they do not hold", async () => {
      await subRole(admin, "role-editor-delete", ["roles.manage"]);
      await subRole(admin, "watchers", ["audit.read"]);
      await subRole(admin, "managers", ["roles.manage"]);
      const { client } = await memberClient(app, admin, "role-editor-3", ["user", "role-editor-delete"]);
      const refused = await client.request("DELETE", "/admin/roles/watchers");
      expect(refused.status).toBe(403);
      expect(refused.raw).toContain("audit.read");
      expect((await admin.get("/admin/roles/watchers")).status).toBe(200);
      expect((await client.request("DELETE", "/admin/roles/managers")).status).toBe(204);
      expect((await admin.request("DELETE", "/admin/roles/watchers")).status).toBe(204);
    });
  });

  describe("last admin", () => {
    it("nobody removes or disables themselves", async () => {
      expect((await admin.request("DELETE", `/admin/users/${adminId}`)).status).toBe(409);
      expect((await admin.request("PATCH", `/admin/users/${adminId}`, { body: { enabled: false } })).status).toBe(409);
    });

    it("the last enabled admin cannot be demoted, disabled or removed", async () => {
      const { client: second, id: secondId } = await memberClient(app, admin, "admin-two", ["admin"]);
      // admin-two demotes / removes the bootstrap admin: allowed while another admin remains…
      expect((await second.request("PATCH", `/admin/users/${adminId}`, { body: { roleIds: ["user"] } })).status).toBe(200);
      // …but now admin-two is the last admin and the original admin lost its rights.
      const bootstrap = await adminClient(app);
      expect((await bootstrap.get("/admin/users")).status).toBe(403);
      expect((await second.request("PATCH", `/admin/users/${secondId}`, { body: { roleIds: ["user"] } })).status).toBe(409);
      // Restore the bootstrap admin for later tests.
      expect((await second.request("PATCH", `/admin/users/${adminId}`, { body: { roleIds: ["admin"] } })).status).toBe(200);
      admin = await adminClient(app);
      expect((await admin.request("DELETE", `/admin/users/${secondId}`)).status).toBe(204);
    });

    it("the admin role keeps members.manage and roles.manage", async () => {
      const permissions = (await admin.get<{ code: string }[]>("/admin/roles/permissions")).body.data!.map((permission) => permission.code);
      const withoutLocked = permissions.filter((code) => code !== "roles.manage");
      expect((await admin.request("PUT", "/admin/roles/admin/permissions", { body: { permissions: withoutLocked } })).status).toBe(409);
    });

    it("a member holds exactly one primary role", async () => {
      const none = await admin.request("POST", "/admin/users", { body: { username: "no-primary", password: "password-123", roleIds: ["people-ops"] } });
      const two = await admin.request("POST", "/admin/users", { body: { username: "two-primary", password: "password-123", roleIds: ["user", "admin"] } });
      expect(none.status).toBe(400);
      expect(two.status).toBe(400);
    });
  });

  describe("session revocation", () => {
    it("a password reset ends the member's sessions", async () => {
      const { client, id } = await memberClient(app, admin, "reset-me", ["user"]);
      expect((await client.get("/auth/me")).status).toBe(200);
      expect((await admin.request("POST", `/admin/users/${id}/password`, { body: { password: "brand-new-pass" } })).status).toBeLessThan(300);
      expect((await client.get("/auth/me")).status).toBe(401);
    });

    it("a password reset or a disable ends the member's tokens and AI-client connections too, and nobody else's", async () => {
      const credentials = async (userId: string) => {
        const token = MEMBER_TOKEN_PREFIX + randomBytes(32).toString("base64url");
        await app.db.query("insert into core.member_token (id, user_id, name, token_hash, expires_at) values ($1, $2, 'cli', $3, now() + interval '1 hour')", [newId(), userId, hashToken(token)]);
        const connection = newId();
        await app.db.query("insert into core.member_connection (id, user_id, client_name) values ($1, $2, 'Claude Code')", [connection, userId]);
        await app.db.query("insert into core.member_connection_refresh_token (token_hash, connection_id) values ($1, $2)", [randomBytes(32).toString("hex"), connection]);
        return { token, connection };
      };
      const read = (token: string) => new Client(app).request("GET", "/member/v1/projects", { csrf: false, headers: { authorization: `Bearer ${token}` } });
      const ended = async (connection: string) =>
        (await app.db.query<{ revoked: boolean; consumed: boolean }>(
          "select c.revoked_at is not null as revoked, bool_and(r.consumed_at is not null) as consumed from core.member_connection c join core.member_connection_refresh_token r on r.connection_id = c.id where c.id = $1 group by c.id",
          [connection],
        )).rows[0];

      const { id: resetId } = await memberClient(app, admin, "reset-tokens", ["user"]);
      const { id: otherId } = await memberClient(app, admin, "keeps-tokens", ["user"]);
      const reset = await credentials(resetId);
      const other = await credentials(otherId);
      expect((await read(reset.token)).status).toBe(200);
      expect((await admin.request("POST", `/admin/users/${resetId}/password`, { body: { password: "brand-new-pass" } })).status).toBeLessThan(300);
      expect((await read(reset.token)).status).toBe(401);
      expect(await ended(reset.connection)).toEqual({ revoked: true, consumed: true });
      expect((await read(other.token)).status).toBe(200);
      expect(await ended(other.connection)).toEqual({ revoked: false, consumed: false });
      const audit = await app.db.query<{ detail: { revoked?: { tokens: number; connections: number } } }>("select detail from governance.audit_event where action = 'user.password' and subject = $1", [resetId]);
      expect(audit.rows[0]?.detail.revoked).toEqual({ tokens: 1, connections: 1 });

      const { id: disabledId } = await memberClient(app, admin, "disable-tokens", ["user"]);
      const disabled = await credentials(disabledId);
      expect((await admin.request("PATCH", `/admin/users/${disabledId}`, { body: { enabled: false } })).status).toBe(200);
      expect((await read(disabled.token)).status).toBe(401);
      expect(await ended(disabled.connection)).toEqual({ revoked: true, consumed: true });
    });

    it("disabling a member ends their sessions and blocks sign-in", async () => {
      const { client, id, password } = await memberClient(app, admin, "disable-me", ["user"]);
      expect((await admin.request("PATCH", `/admin/users/${id}`, { body: { enabled: false } })).status).toBe(200);
      expect((await client.get("/auth/me")).status).toBe(401);
      expect((await new Client(app).login("disable-me", password)).status).toBe(401);
    });
  });

  describe("password hashes", () => {
    it("the bootstrap admin is stored as argon2id", async () => {
      const row = await app.db.query<{ password_hash: string; password_salt: string }>(
        "select password_hash, password_salt from core.app_user where username = $1",
        [ADMIN_USER],
      );
      expect(row.rows[0]?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(row.rows[0]?.password_salt).toBe("");
    });

    it("a legacy scrypt hash still signs in and is upgraded to argon2id", async () => {
      const { id } = await memberClient(app, admin, "legacy-user", ["user"]);
      const salt = "bGVnYWN5LXNhbHQ=";
      const legacy = scryptSync("legacy-password", salt, 32).toString("base64");
      await app.db.query("update core.app_user set password_hash = $2, password_salt = $3 where id = $1", [id, legacy, salt]);

      expect((await new Client(app).login("legacy-user", "wrong-password")).status).toBe(401);
      const unchanged = await app.db.query<{ password_hash: string }>("select password_hash from core.app_user where id = $1", [id]);
      expect(unchanged.rows[0]?.password_hash).toBe(legacy);

      expect((await new Client(app).login("legacy-user", "legacy-password")).status).toBe(200);
      const upgraded = await app.db.query<{ password_hash: string; password_salt: string }>(
        "select password_hash, password_salt from core.app_user where id = $1",
        [id],
      );
      expect(upgraded.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
      expect(upgraded.rows[0]?.password_salt).toBe("");
      expect((await new Client(app).login("legacy-user", "legacy-password")).status).toBe(200);
    });
  });
});
