// Sign-in, session cookie, CSRF, guard order and lockout (ADR-0008).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { ADMIN_PASSWORD, ADMIN_USER, Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../support/app.js";

describe.skipIf(!hasDatabase)("auth (integration)", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  describe("session cookie", () => {
    it("login sets an httpOnly SameSite=Strict cookie scoped to /api and returns no token", async () => {
      const client = new Client(app);
      const response = await client.login(ADMIN_USER, ADMIN_PASSWORD);
      expect(response.status).toBe(200);
      const cookie = response.headers.getSetCookie().find((value) => value.startsWith("kintsugi_session="))!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api/i);
      expect(response.body.data).toHaveProperty("user");
      expect(response.raw).not.toMatch(/"token"/);
      const token = client.cookie!.split("=")[1]!;
      expect(response.raw).not.toContain(token);
    });

    it("/auth/me works with the cookie and logout ends the session", async () => {
      const client = await adminClient(app);
      const me = await client.get<{ username: string; permissions: string[] }>("/auth/me");
      expect(me.status).toBe(200);
      expect(me.body.data?.username).toBe(ADMIN_USER);
      expect(me.body.data?.permissions).toContain("members.manage");

      const stolen = client.cookie;
      expect((await client.request("POST", "/auth/logout")).status).toBe(204);
      expect(client.cookie).toBeUndefined();
      // The old cookie value is revoked server-side, not just cleared in the browser.
      client.cookie = stolen;
      expect((await client.get("/auth/me")).status).toBe(401);
    });

    it("unknown users and wrong passwords get the same answer", async () => {
      const unknown = await new Client(app).login("nobody-here", "whatever-password");
      const wrong = await new Client(app).login(ADMIN_USER, "wrong-password");
      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(unknown.body.message).toEqual(wrong.body.message);
    });
  });

  describe("csrf", () => {
    it("rejects unsafe cookie requests without the header and accepts them with it", async () => {
      const client = await adminClient(app);
      const body = { id: "csrf-probe", name: "csrf probe" };
      const blocked = await client.request("POST", "/admin/roles", { body, csrf: false });
      expect(blocked.status).toBe(403);
      expect(blocked.body.message).toMatch(/CSRF/);
      expect((await client.request("POST", "/admin/roles", { body })).status).toBe(201);
    });

    it("rejects login without the header too", async () => {
      const response = await new Client(app).request("POST", "/auth/login", { body: { username: ADMIN_USER, password: ADMIN_PASSWORD }, csrf: false });
      expect(response.status).toBe(403);
    });

    it("exempts bearer-authenticated requests", async () => {
      const client = await adminClient(app);
      const token = client.cookie!.split("=")[1]!;
      const bearer = new Client(app);
      const response = await bearer.request("POST", "/admin/roles", {
        body: { id: "bearer-probe", name: "bearer probe" },
        csrf: false,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(201);
    });
  });

  describe("guards", () => {
    it("401 without a session, 403 without the permission", async () => {
      expect((await new Client(app).get("/admin/users")).status).toBe(401);
      const admin = await adminClient(app);
      const { client } = await memberClient(app, admin, "plain-user", ["user"]);
      expect((await client.get("/admin/users")).status).toBe(403);
    });

    it("csrf is checked before authentication", async () => {
      const response = await new Client(app).request("POST", "/admin/roles", { body: { id: "x", name: "x" }, csrf: false });
      expect(response.status).toBe(403);
    });

    it("a route with several permission codes accepts any one of them", async () => {
      // GET /admin/roles requires roles.manage OR members.manage.
      const admin = await adminClient(app);
      await subRole(admin, "members-only", ["members.manage"]);
      const { client } = await memberClient(app, admin, "members-mgr", ["user", "members-only"]);
      expect((await client.get("/admin/roles")).status).toBe(200);
      expect((await client.get("/admin/roles/permissions")).status).toBe(403);
    });
  });

  describe("lockout", () => {
    it("locks an account after 5 failures, even for the right password, without affecting others", async () => {
      const admin = await adminClient(app);
      const { client, password } = await memberClient(app, admin, "lock-target", ["user"]);
      await client.request("POST", "/auth/logout");
      for (let attempt = 0; attempt < 5; attempt++) {
        expect((await new Client(app).login("lock-target", "wrong-password")).status).toBe(401);
      }
      const locked = await new Client(app).login("LOCK-TARGET", "wrong-password");
      expect(locked.status).toBe(429);
      // The real password does not bypass the lock; other accounts are unaffected.
      expect((await new Client(app).login("lock-target", password)).status).toBe(429);
      expect((await new Client(app).login(ADMIN_USER, ADMIN_PASSWORD)).status).toBe(200);
    });
  });
});
