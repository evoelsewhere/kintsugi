// Members and roles guard rails, session revocation and password hash upgrades (ADR-0008).

import { scryptSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
