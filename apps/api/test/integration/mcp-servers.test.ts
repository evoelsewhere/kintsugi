// The MCP server registry (integration): admin-managed HTTP servers for runtime agents (ADR-0047).
// Header values are credentials: stored encrypted, never returned, never audited. The connection test
// talks to a real (fake) MCP server, and the worker's loader reads the servers back with the headers decrypted.

import { loadMcpServers } from "@kintsugi/runtime/launcher";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../support/app.js";
import { MCP_TOKEN, startFakeMcpServer, type FakeMcpServer } from "../support/mcp-server.js";

interface View {
  id: string;
  url: string;
  description?: string;
  enabled: boolean;
  timeoutSec: number;
  allowedTools: string[];
  headerNames: string[];
  toolPrefix: string;
  toolEntry: string;
}

interface Tested {
  ok: boolean;
  message: string;
  serverName?: string;
  tools: Array<{ name: string; readOnly: boolean; allowed: boolean }>;
}

interface Audit {
  items: Array<{ action: string; subject?: string; detail: Record<string, unknown> }>;
}

describe.skipIf(!hasDatabase)("MCP servers (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let fake: FakeMcpServer;
  const bodies: string[] = [];

  const call = async <T>(method: string, path: string, body?: unknown) => {
    const response = await admin.request<T>(method, path, body === undefined ? {} : { body });
    bodies.push(response.raw);
    return response;
  };

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    fake = await startFakeMcpServer();
  });
  afterAll(async () => {
    await fake?.close();
    await app?.close();
  });

  it("every route requires mcp.manage, and the choices also agents.manage", async () => {
    const { client } = await memberClient(app, admin, "no-mcp", ["user"]);
    for (const [method, path] of [
      ["GET", "/admin/mcp-servers"],
      ["GET", "/admin/mcp-servers/choices"],
      ["GET", "/admin/mcp-servers/any"],
      ["POST", "/admin/mcp-servers"],
      ["PATCH", "/admin/mcp-servers/any"],
      ["POST", "/admin/mcp-servers/any/test"],
      ["DELETE", "/admin/mcp-servers/any"],
    ] as const) {
      const response = await client.request(method, path, method === "GET" || method === "DELETE" ? {} : { body: {} });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    await subRole(admin, "agent-builder", ["agents.manage"]);
    const { client: builder } = await memberClient(app, admin, "builder", ["user", "agent-builder"]);
    expect((await builder.get("/admin/mcp-servers/choices")).status).toBe(200);
    expect((await builder.get("/admin/mcp-servers")).status).toBe(403);
  });

  it("registers a server, keeps its header encrypted and never returns it", async () => {
    const created = await call<View>("POST", "/admin/mcp-servers", {
      id: "docs",
      url: fake.url,
      description: "Documentation lookups",
      timeoutSec: 20,
      allowedTools: ["export_*"],
      headers: { Authorization: `Bearer ${MCP_TOKEN}` },
    });
    expect(created.status, created.raw).toBe(201);
    expect(created.body.data).toMatchObject({ id: "docs", enabled: true, timeoutSec: 20, allowedTools: ["export_*"], headerNames: ["authorization"], toolPrefix: "mcp__docs__", toolEntry: "mcp__docs__*" });
    await call("GET", "/admin/mcp-servers");
    await call("GET", "/admin/mcp-servers/docs");
    await call("GET", "/admin/mcp-servers/choices");
    const secrets = await app.db.query<{ ciphertext: string }>("select ciphertext from admin.mcp_secret where server_id = 'docs'");
    expect(secrets.rows).toHaveLength(1);
    expect(secrets.rows[0]!.ciphertext).not.toContain(MCP_TOKEN);
    const config = await app.db.query<{ headers: unknown }>("select headers from admin.mcp_server where id = 'docs'");
    expect(JSON.stringify(config.rows)).not.toContain(MCP_TOKEN);
    for (const raw of bodies) expect(raw).not.toContain(MCP_TOKEN);
  });

  it("offers the servers to an agent builder without their address or headers", async () => {
    const choices = await call<Array<Record<string, unknown>>>("GET", "/admin/mcp-servers/choices");
    expect(choices.body.data).toEqual([{ id: "docs", description: "Documentation lookups", enabled: true, toolEntry: "mcp__docs__*" }]);
  });

  it("refuses a duplicate id, a bad id or address, and a header value pi would run as a command", async () => {
    const valid = { url: fake.url, headers: {} };
    expect((await call("POST", "/admin/mcp-servers", { id: "docs", ...valid })).status).toBe(409);
    expect((await call("POST", "/admin/mcp-servers", { id: "Bad_Id", ...valid })).status).toBe(400);
    expect((await call("POST", "/admin/mcp-servers", { id: "ftp", url: "ftp://example.invalid/mcp" })).status).toBe(400);
    expect((await call("POST", "/admin/mcp-servers", { id: "cmd", url: fake.url, headers: { Authorization: "!cat /etc/passwd" } })).status).toBe(400);
    expect((await call("POST", "/admin/mcp-servers", { id: "env", url: fake.url, headers: { Authorization: "Bearer ${HOME}" } })).status).toBe(400);
    expect((await call("POST", "/admin/mcp-servers", { id: "keep", url: fake.url, headers: { Authorization: null } })).status).toBe(400);
    expect((await call("POST", "/admin/mcp-servers", { id: "dupe", url: fake.url, headers: { A: "x", a: "y" } })).status).toBe(400);
    expect((await call("GET", "/admin/mcp-servers/nope")).status).toBe(404);
  });

  it("tests the connection: lists the tools and which of them agents can use", async () => {
    const tested = await call<Tested>("POST", "/admin/mcp-servers/docs/test");
    expect(tested.status).toBe(200);
    expect(tested.body.data).toMatchObject({ ok: true, serverName: "fake-docs" });
    expect(tested.body.data!.tools).toEqual([
      expect.objectContaining({ name: "mcp__docs__lookup", readOnly: true, allowed: true }),
      expect.objectContaining({ name: "mcp__docs__create_issue", readOnly: false, allowed: false }),
      expect.objectContaining({ name: "mcp__docs__export_all", readOnly: false, allowed: true }),
    ]);
    expect(fake.authorizations.filter((value) => value === `Bearer ${MCP_TOKEN}`).length).toBeGreaterThan(0);
  });

  it("reports a failed connection as a result", async () => {
    await call("POST", "/admin/mcp-servers", { id: "wrong", url: fake.url, headers: { Authorization: "Bearer wrong" } });
    const tested = await call<Tested>("POST", "/admin/mcp-servers/wrong/test");
    expect(tested.status).toBe(200);
    expect(tested.body.data).toMatchObject({ ok: false, tools: [] });
    expect(tested.body.data!.message).toMatch(/Could not connect/);
    await call("DELETE", "/admin/mcp-servers/wrong");
  });

  it("changes the settings, keeps a header on null, and re-enters headers when the address changes", async () => {
    const kept = await call<View>("PATCH", "/admin/mcp-servers/docs", { url: fake.url, enabled: false, allowedTools: [], headers: { Authorization: null } });
    expect(kept.status, kept.raw).toBe(200);
    expect(kept.body.data).toMatchObject({ enabled: false, allowedTools: [], headerNames: ["authorization"] });
    const stillWorks = await call<Tested>("POST", "/admin/mcp-servers/docs/test");
    expect(stillWorks.body.data!.ok).toBe(true);

    const moved = await call("PATCH", "/admin/mcp-servers/docs", { url: fake.url.replace("127.0.0.1", "localhost"), headers: { Authorization: null } });
    expect(moved.status).toBe(400);
    const movedWithHeader = await call<View>("PATCH", "/admin/mcp-servers/docs", { url: fake.url.replace("127.0.0.1", "localhost"), enabled: true, headers: { Authorization: `Bearer ${MCP_TOKEN}` } });
    expect(movedWithHeader.status, movedWithHeader.raw).toBe(200);
    // A replacement is the whole configuration (what it leaves out goes back to its default), and a new address needs its headers entered again.
    await call("PATCH", "/admin/mcp-servers/docs", { url: fake.url, description: "Documentation lookups", timeoutSec: 20, enabled: true, allowedTools: ["export_*"], headers: { Authorization: `Bearer ${MCP_TOKEN}` } });
    expect((await call("PATCH", "/admin/mcp-servers/nope", { url: fake.url })).status).toBe(404);
  });

  it("gives the worker the enabled servers with their headers decrypted, and refuses a missing or disabled one", async () => {
    const [docs] = await loadMcpServers(["docs"], app.db.url);
    expect(docs).toMatchObject({ name: "docs", url: fake.url, headers: { authorization: `Bearer ${MCP_TOKEN}` }, timeoutSec: 20, allowedTools: ["export_*"], description: "Documentation lookups" });
    await expect(loadMcpServers(["docs", "ghost"], app.db.url)).rejects.toThrow(/"ghost" is not registered or is disabled/);
    await call("PATCH", "/admin/mcp-servers/docs", { url: fake.url, enabled: false, allowedTools: ["export_*"], headers: { Authorization: null } });
    await expect(loadMcpServers(["docs"], app.db.url)).rejects.toThrow(/"docs" is not registered or is disabled/);
    expect(await loadMcpServers([], app.db.url)).toEqual([]);
  });

  it("audits every change with names and hosts, never header values", async () => {
    const audit = await call<Audit>("GET", "/governance/audit?action=mcp-server.create,mcp-server.update&limit=100");
    expect(audit.status).toBe(200);
    expect(audit.body.data!.items.some((entry) => entry.action === "mcp-server.create" && entry.subject === "docs")).toBe(true);
    expect(JSON.stringify(audit.body.data)).not.toContain(MCP_TOKEN);
    const update = audit.body.data!.items.find((entry) => entry.action === "mcp-server.update" && Array.isArray(entry.detail["fields"]));
    expect(update?.detail["fields"]).toEqual(expect.arrayContaining(["enabled"]));
  });

  it("removes a server and its secrets", async () => {
    expect((await call("DELETE", "/admin/mcp-servers/docs")).status).toBe(204);
    expect((await call("DELETE", "/admin/mcp-servers/docs")).status).toBe(404);
    const secrets = await app.db.query("select 1 from admin.mcp_secret where server_id = 'docs'");
    expect(secrets.rowCount).toBe(0);
    const remaining = await call<View[]>("GET", "/admin/mcp-servers");
    expect(remaining.body.data!.map((server) => server.id)).toEqual([]);
  });
});
