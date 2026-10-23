// Without KINTSUGI_DEBUG_MCP the debug MCP server does not exist (ADR-0056): the route answers 404 even to the administrator.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { ADMIN_PASSWORD, ADMIN_USER, startTestApp, type TestApp } from "../support/app.js";

delete process.env["KINTSUGI_DEBUG_MCP"];

describe.skipIf(!hasDatabase)("debug MCP server off (integration)", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it("has no route", async () => {
    const authorization = `Basic ${Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString("base64")}`;
    const response = await fetch(`${app.baseUrl}/debug/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    expect(response.status).toBe(404);
    expect((await fetch(`${app.baseUrl}/debug/mcp`, { headers: { authorization } })).status).toBe(404);
  });
});
