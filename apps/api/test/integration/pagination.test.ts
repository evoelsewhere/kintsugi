// List endpoints return the uniform Page<T> payload (common/application/pagination.ts).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { type Client, adminClient, startTestApp, type TestApp } from "../support/app.js";

interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

describe.skipIf(!hasDatabase)("pagination (integration)", () => {
  let app: TestApp;
  let admin: Client;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    for (const name of ["member-a", "member-b", "member-c", "member-d"]) {
      const created = await admin.request("POST", "/admin/users", { body: { username: name, password: "password-123", roleIds: ["user"] } });
      expect(created.status).toBe(201);
    }
  });
  afterAll(async () => {
    await app?.close();
  });

  it("pages members in username order with the total", async () => {
    const first = await admin.get<Page<{ username: string }>>("/admin/users?limit=2&offset=0");
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ total: 5, limit: 2, offset: 0 });
    expect(first.body.data!.items.map((user) => user.username)).toEqual(["admin", "member-a"]);

    const last = await admin.get<Page<{ username: string }>>("/admin/users?limit=2&offset=4");
    expect(last.body.data!.items.map((user) => user.username)).toEqual(["member-d"]);
  });

  it("reports the total past the last page", async () => {
    const beyond = await admin.get<Page<unknown>>("/admin/users?limit=2&offset=50");
    expect(beyond.body.data).toEqual({ items: [], total: 5, limit: 2, offset: 50 });
  });

  it("defaults to limit 50 and rejects invalid limits", async () => {
    expect((await admin.get<Page<unknown>>("/admin/users")).body.data).toMatchObject({ limit: 50, offset: 0, total: 5 });
    expect((await admin.get("/admin/users?limit=0")).status).toBe(400);
    expect((await admin.get("/admin/users?limit=500")).status).toBe(400);
  });

  it("pages roles and providers the same way", async () => {
    const roles = await admin.get<Page<{ id: string }>>("/admin/roles?limit=1");
    expect(roles.body.data).toMatchObject({ limit: 1, offset: 0 });
    expect(roles.body.data!.items).toHaveLength(1);
    expect(roles.body.data!.total).toBeGreaterThanOrEqual(3);
    expect((await admin.get<Page<unknown>>("/admin/llm-providers")).body.data).toMatchObject({ items: [], total: 0 });
  });
});
