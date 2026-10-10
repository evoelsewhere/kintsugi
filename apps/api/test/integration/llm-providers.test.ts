// LLM provider registry: permission gate, credential confidentiality and the
// endpoint-change rule (ADR-0009).

import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgLlmProviderRepository } from "../../src/modules/admin/llm-providers/infrastructure/pg-llm-provider.repository.js";
import { LlmProviderRepository } from "../../src/modules/admin/llm-providers/domain/llm-provider.repository.js";
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

  it("encrypts legacy plaintext header values at startup", async () => {
    const plaintext = "LEGACY-HEADER-SECRET-value";
    await app.db.query("insert into admin.llm_provider (id, kind, config) values ($1, $2, $3)", [
      "legacy-headers",
      "custom",
      JSON.stringify({
        id: "legacy-headers",
        kind: "custom",
        enabled: true,
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:9/v1",
        models: [{ id: "m1" }],
        headers: { "x-api-key": plaintext },
        auth: { type: "none" },
      }),
    ]);

    // What onApplicationBootstrap runs when an installation with legacy rows starts.
    await (app.nest.get(LlmProviderRepository) as PgLlmProviderRepository).encryptLegacyHeaders();
    const fetched = await admin.request("GET", "/admin/llm-providers/legacy-headers");
    expect(fetched.raw).not.toContain(plaintext);
    expect(fetched.raw).toContain("[secret]");
    const config = await app.db.query<{ config: unknown }>("select config from admin.llm_provider where id = 'legacy-headers'");
    expect(JSON.stringify(config.rows)).not.toContain(plaintext);
    const secrets = await app.db.query<{ secret_id: string; ciphertext: string }>("select secret_id, ciphertext from admin.llm_secret where provider_id = 'legacy-headers'");
    expect(secrets.rows).toHaveLength(1);
    expect(secrets.rows[0]?.secret_id).toBe("provider:legacy-headers:header:x-api-key");
    expect(secrets.rows[0]?.ciphertext).not.toContain(plaintext);
  });

  it("keeps stored header values only on the same endpoint", async () => {
    const created = await call("POST", "/admin/llm-providers", {
      kind: "custom",
      id: "header-gateway",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:9/v1",
      models: [{ id: "m1" }],
      apiKey: API_KEY,
      headers: { "X-Gateway-Key": "HEADER-BOUND-secret" },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ headers: { "x-gateway-key": "[secret]" } });

    // A new API key does not carry the stored header value to another host.
    const repointed = await call("PATCH", "/admin/llm-providers/header-gateway", {
      kind: "custom",
      api: "openai-completions",
      baseUrl: "http://elsewhere.invalid/v1",
      models: [{ id: "m1" }],
      apiKey: "sk-other",
      headers: { "x-gateway-key": null },
    });
    expect(repointed.status).toBe(400);

    const sameHost = await call("PATCH", "/admin/llm-providers/header-gateway", {
      kind: "custom",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:9/v1",
      models: [{ id: "m1" }],
      apiKey: "sk-rotated",
      headers: { "X-GATEWAY-KEY": null },
    });
    expect(sameHost.status).toBe(200);
    const secrets = await app.db.query<{ secret_id: string }>("select secret_id from admin.llm_secret where provider_id = 'header-gateway' order by secret_id");
    expect(secrets.rows.map((row) => row.secret_id)).toEqual(["provider:header-gateway:api-key", "provider:header-gateway:header:x-gateway-key"]);
  });

  it("rejects header names that differ only by case", async () => {
    const response = await call("POST", "/admin/llm-providers", {
      kind: "custom",
      id: "dup-headers",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:9/v1",
      models: [{ id: "m1" }],
      headers: { "X-Key": "a", "x-key": "b" },
    });
    expect(response.status).toBe(400);
  });

  it("sends custom headers with the connection probe", async () => {
    let received: IncomingHttpHeaders | undefined;
    const server = createServer((request, response) => {
      received = request.headers;
      response.writeHead(200, { "content-type": "application/json" }).end('{"data":[]}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const created = await call("POST", "/admin/llm-providers", {
        kind: "custom",
        id: "probe-headers",
        api: "openai-completions",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        models: [{ id: "m1" }],
        apiKey: "sk-probe",
        headers: { "x-tenant": "tenant-42" },
      });
      expect(created.status).toBe(201);
      const tested = await call("POST", "/admin/llm-providers/probe-headers/test");
      expect(tested.body.data).toMatchObject({ ok: true });
      expect(received?.["x-tenant"]).toBe("tenant-42");
      expect(received?.["authorization"]).toBe("Bearer sk-probe");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("no response in this suite contained a credential", () => {
    expect(bodies.length).toBeGreaterThan(5);
    for (const raw of bodies) {
      expect(raw).not.toContain(API_KEY);
      expect(raw).not.toContain(ENV_SECRET);
      expect(raw).not.toContain("sk-test-SECRET-second-key");
      expect(raw).not.toContain("HEADER-BOUND-secret");
    }
  });

  it("does not return or store custom header values in plaintext", async () => {
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
    const updated = await admin.request("PATCH", "/admin/llm-providers/with-headers", {
      body: {
        kind: "custom",
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:9/v1",
        models: [{ id: "m1" }],
        headers: { "x-api-key": null },
      },
    });
    expect(updated.raw).not.toContain("HEADER-SECRET-value");
    expect(updated.raw).toContain("[secret]");
    const config = await app.db.query<{ config: unknown }>("select config from admin.llm_provider where id = 'with-headers'");
    expect(JSON.stringify(config.rows)).not.toContain("HEADER-SECRET-value");
    const secrets = await app.db.query<{ secret_id: string; ciphertext: string }>("select secret_id, ciphertext from admin.llm_secret where provider_id = 'with-headers'");
    expect(secrets.rows).toHaveLength(1);
    expect(secrets.rows[0]?.secret_id).toBe("provider:with-headers:header:x-api-key");
    expect(secrets.rows[0]?.ciphertext).not.toContain("HEADER-SECRET-value");
  });
});
