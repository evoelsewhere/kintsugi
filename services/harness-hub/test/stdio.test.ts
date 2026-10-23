import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";

const fixture = fileURLToPath(new URL("./fixtures/stdio-server.mjs", import.meta.url));
const clients: Client[] = [];

async function connect(mode: "legacy" | "auto", reviews = false, fail = false): Promise<Client> {
  const client = new Client(
    { name: "kintsugi-test-client", version: "1.0.0" },
    { versionNegotiation: { mode } },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fixture],
    env: { ...process.env, ...(reviews ? { KINTSUGI_TEST_REVIEWS: "1" } : {}), ...(fail ? { KINTSUGI_TEST_FAILURE: "1", KINTSUGI_TEST_ERROR_MESSAGE: "TEST-private-token" } : {}) },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => {
    try { await client.close(); } catch { /* the test already observed the transport failure */ }
  }));
});

describe("Coding Agent Workflow stdio MCP process", () => {
  it.each(["legacy", "auto"] as const)("initializes and serves explicit read-only context with %s negotiation", async (mode) => {
    const client = await connect(mode);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();

    expect(names).toEqual([
      "document_get",
      "document_search",
      "project_list",
      "task_brief",
      "task_list",
      "task_status",
    ]);
    expect(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(listed.tools.find((tool) => tool.name === "task_brief")?.annotations?.idempotentHint).toBe(false);

    const documentTool = listed.tools.find((tool) => tool.name === "document_get");
    expect(documentTool?.inputSchema.required).toEqual(expect.arrayContaining([
      "projectId", "unitId", "snapshotId", "sourceId",
    ]));

    const first = await client.callTool({
      name: "document_get",
      arguments: { projectId: "shop", unitId: "billing/invoices/tax", snapshotId: "ctx_A", sourceId: "src_design" },
    });
    expect(first.isError).not.toBe(true);
    const data = first.structuredContent as Record<string, unknown>;
    expect(data).toMatchObject({ projectId: "shop", unitId: "billing/invoices/tax", snapshotId: "ctx_A", sourceId: "src_design" });
    const text = first.content.find((part) => part.type === "text");
    expect(text?.type === "text" ? JSON.parse(text.text) : null).toEqual(data);

    const second = await client.callTool({
      name: "document_get",
      arguments: { projectId: "other", unitId: "billing/payments/refund", snapshotId: "ctx_B", sourceId: "src_rules" },
    });
    expect(second.structuredContent).toMatchObject({ projectId: "other", unitId: "billing/payments/refund", snapshotId: "ctx_B", sourceId: "src_rules" });
  });

  it("rejects calls that omit the required snapshot before reaching the adapter", async () => {
    const client = await connect("legacy");
    const result = await client.callTool({
      name: "document_get",
      arguments: { projectId: "shop", unitId: "billing/invoices/tax", sourceId: "src_design" },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects malformed selectors before calling a read tool", async () => {
    const client = await connect("legacy");
    const result = await client.callTool({
      name: "document_get",
      arguments: { projectId: "shop", unitId: "billing/invoices/tax", snapshotId: "ctx_A", sourceId: "src_design", path: "../../private" },
    });
    expect(result.isError).toBe(true);
  });

  it("maps adapter errors to stable codes without exposing messages", async () => {
    const client = await connect("legacy", false, true);
    const result = await client.callTool({ name: "project_list", arguments: {} });
    expect(result.isError).toBe(true);
    const text = result.content.filter((part) => part.type === "text").map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(text).toContain("TOKEN_EXPIRED");
    expect(JSON.stringify(result)).not.toContain("TEST-private-token");
  });

  it("advertises review retrieval only when its capability is enabled", async () => {
    const client = await connect("auto", true);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("review_get");
    const result = await client.callTool({ name: "review_get", arguments: { projectId: "shop", reviewId: "review_001" } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ reviewId: "review_001", verdict: "pass" });
  });

  it("exits cleanly when stdin reaches EOF before initialization", async () => {
    const child = spawn(process.execPath, [fixture], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stdin.end();
    const [code] = await once(child, "close") as [number | null];
    expect(code).toBe(0);
    expect(Buffer.concat(stdout).toString("utf8")).toBe("");
  });
});
