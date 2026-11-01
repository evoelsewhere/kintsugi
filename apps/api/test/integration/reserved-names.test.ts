// A resource cannot take the name of a fixed route beside it (`GET …/context` would answer instead of the agent `context`).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, startTestApp, type TestApp } from "../support/app.js";

describe.skipIf(!hasDatabase)("names reserved by routes (integration)", () => {
  let app: TestApp;
  let admin: Client;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("refuses an agent, project, sub-role, LLM provider or MCP server named like a route beside it", async () => {
    const refused = async (path: string, body: unknown, word: string): Promise<void> => {
      const response = await admin.request("POST", path, { body });
      expect(response.status, `${path} ${word}`).toBe(400);
      expect(response.raw, `${path} ${word}`).toContain(word);
    };
    await refused("/admin/agents/legacy-analyst/copy", { name: "context" }, "context");
    await refused("/admin/projects", { id: "repository-links", name: "x", documentRepositoryId: "docs" }, "repository-links");
    await refused("/admin/roles", { id: "permissions", name: "x" }, "permissions");
    await refused("/admin/llm-providers", { kind: "custom", id: "supported", api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", models: [{ id: "m" }] }, "supported");
    await refused("/admin/llm-providers", { kind: "custom", id: "model-bindings", api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", models: [{ id: "m" }] }, "model-bindings");
    await refused("/admin/mcp-servers", { id: "choices", name: "x", transport: "http", url: "http://127.0.0.1:9/mcp" }, "choices");
    // The routes still answer as themselves.
    expect((await admin.get<{ kernelTools: string[] }>("/admin/agents/context")).body.data?.kernelTools).toBeDefined();
    expect((await admin.get("/admin/roles/permissions")).status).toBe(200);
    expect((await admin.get("/admin/llm-providers/supported")).status).toBe(200);
  });
});
