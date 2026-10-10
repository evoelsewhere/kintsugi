// LLM provider registry: permission gate, credential confidentiality and the
// endpoint-change rule (ADR-0009).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

const API_KEY = "sk-test-SECRET-api-key-0123456789";
const ENV_SECRET = "env-SECRET-value-9876543210";

describe.skipIf(!hasDatabase)("llm providers (integration)", () => {
  let app: TestApp;
  let admin: Client;
  const bodies: string[] = [];

  /** Every response in this suite is recorded and checked for leaked secrets at the end. */
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await admin.request(method, path, body === undefined ? {} : { body });
    bodies.push(response.raw);
    return response;
  };

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("every route requires providers.manage", async () => {
    const { client } = await memberClient(app, admin, "no-providers", ["user"]);
    for (const [method, path] of [
      ["GET", "/admin/llm-providers"],
      ["GET", "/admin/llm-providers/supported"],
      ["GET", "/admin/llm-providers/model-bindings"],
      ["PUT", "/admin/llm-providers/model-bindings"],
      ["POST", "/admin/llm-providers"],
      ["GET", "/admin/llm-providers/any"],
      ["PATCH", "/admin/llm-providers/any"],
      ["POST", "/admin/llm-providers/any/test"],
      ["DELETE", "/admin/llm-providers/any"],
    ] as const) {
      const response = await client.request(method, path, method === "GET" || method === "DELETE" ? {} : { body: {} });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("stores credentials encrypted and never returns them", async () => {
    const created = await call("POST", "/admin/llm-providers", {
      kind: "custom",
      id: "gateway",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:9/v1",
      models: [{ id: "m1" }],
      apiKey: API_KEY,
      env: { GATEWAY_TOKEN: ENV_SECRET },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ id: "gateway", hasApiKey: true });

    await call("POST", "/admin/llm-providers", { kind: "builtin", id: "anthropic-main", piProvider: "anthropic", apiKey: API_KEY });
    await call("GET", "/admin/llm-providers");
    await call("GET", "/admin/llm-providers/gateway");
    await call("GET", "/admin/llm-providers/anthropic-main");
    await call("PUT", "/admin/llm-providers/model-bindings", [{ agent: "some-agent", provider: "gateway", model: "m1" }]);
    await call("GET", "/admin/llm-providers/model-bindings");
    await call("POST", "/admin/llm-providers/gateway/test");

    const secrets = await app.db.query<{ ciphertext: string }>("select ciphertext from admin.llm_secret");
    expect(secrets.rows.length).toBeGreaterThan(0);
    for (const row of secrets.rows) {
      expect(row.ciphertext).not.toContain(API_KEY);
      expect(row.ciphertext).not.toContain(ENV_SECRET);
    }
    const config = await app.db.query<{ config: unknown }>("select config from admin.llm_provider");
    expect(JSON.stringify(config.rows)).not.toMatch(/SECRET/);
  });

  it("refuses an endpoint change that would reuse the stored credential", async () => {
    const moved = await call("PATCH", "/admin/llm-providers/gateway", {
      kind: "custom",
      api: "openai-completions",
      baseUrl: "http://attacker.example/v1",
      models: [{ id: "m1" }],
    });
    expect(moved.status).toBe(400);

    const withNewKey = await call("PATCH", "/admin/llm-providers/gateway", {
      kind: "custom",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:9/v2",
      models: [{ id: "m1" }],
      apiKey: "sk-test-SECRET-second-key",
    });
    expect(withNewKey.status).toBe(200);

    const sameEndpoint = await call("PATCH", "/admin/llm-providers/gateway", {
      kind: "custom",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:9/v2",
      models: [{ id: "m1" }, { id: "m2" }],
    });
    expect(sameEndpoint.status).toBe(200);
    expect(sameEndpoint.body.data).toMatchObject({ hasApiKey: true });
  });

  it("replacing credentials leaves no orphaned secrets", async () => {
    const remaining = await app.db.query<{ count: number }>("select count(*)::int as count from admin.llm_secret where provider_id = 'gateway'");
    // Created with an api key + one env var; the replacement sent only a new api key,
    // which replaced the whole credential set.
    expect(remaining.rows[0]?.count).toBe(1);
  });

  it("no response in this suite contained a credential", () => {
    expect(bodies.length).toBeGreaterThan(5);
    for (const raw of bodies) {
      expect(raw).not.toContain(API_KEY);
      expect(raw).not.toContain(ENV_SECRET);
      expect(raw).not.toContain("sk-test-SECRET-second-key");
    }
  });

  // Known gap (audit, Medium): custom provider headers are stored in plaintext in the
  // provider config and returned by the API. it.fails keeps the suite green while the
  // gap exists and turns red once headers are protected; then make it a plain `it`.
  it.fails("does not return or store custom header values in plaintext", async () => {
    const created = await admin.request("POST", "/admin/llm-providers", {
      body: {
        kind: "custom",
        id: "with-headers",
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:9/v1",
        models: [{ id: "m1" }],
        headers: { "x-api-key": "HEADER-SECRET-value" },
      },
    });
    expect(created.raw).not.toContain("HEADER-SECRET-value");
    const config = await app.db.query<{ config: unknown }>("select config from admin.llm_provider where id = 'with-headers'");
    expect(JSON.stringify(config.rows)).not.toContain("HEADER-SECRET-value");
  });
});
