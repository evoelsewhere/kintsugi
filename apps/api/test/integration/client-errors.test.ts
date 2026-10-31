// Requests that are the client's fault answer 4xx in the uniform envelope, never 500: a NUL byte the database refuses,
// two creates of the same id at once, a body over the limit or not JSON.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, startTestApp, type TestApp } from "../support/app.js";

describe.skipIf(!hasDatabase)("client errors (integration)", () => {
  let app: TestApp;
  let admin: Client;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("answers a NUL byte in a sign-in, a path or a filter with 400", async () => {
    const login = await fetch(`${app.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kintsugi-csrf": "1" },
      body: JSON.stringify({ username: "adm\u0000in", password: "x" }),
    });
    expect(login.status).toBe(400);
    expect(await login.json()).toMatchObject({ success: false, statusCode: 400, message: "Invalid input" });
    expect((await admin.get("/admin/projects/%00")).status).toBe(400);
    expect((await admin.get("/governance/gates?projectId=%00")).status).toBe(400);
  });

  it("answers the loser of two creates of the same id with 409", async () => {
    const statuses = await Promise.all([0, 1, 2, 3].map(() => admin.request("POST", "/admin/roles", { body: { id: "twins", name: "Twins" } })));
    expect(statuses.map((response) => response.status).sort()).toEqual([201, 409, 409, 409]);
    for (const response of statuses.filter((entry) => entry.status === 409)) expect(response.raw).not.toMatch(/pkey|constraint/);
  });

  it("answers a body over 4 MB with 413 and one that is not JSON with 400", async () => {
    const big = await admin.request("POST", "/admin/projects", { body: { id: "big", name: "x".repeat(5 * 1024 * 1024) } });
    expect(big.status).toBe(413);
    expect(big.body).toMatchObject({ success: false, statusCode: 413, message: "The request body exceeds the 4 MB limit" });
    const malformed = await fetch(`${app.baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-kintsugi-csrf": "1" }, body: '{"username":' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ success: false, statusCode: 400 });
  });
});
