import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";

const fixture = fileURLToPath(new URL("./fixtures/stdio-server.mjs", import.meta.url));
const clients: Client[] = [];

async function connect(mode: "legacy" | "auto", fail = false): Promise<Client> {
  const client = new Client(
    { name: "kintsugi-test-client", version: "1.0.0" },
    { versionNegotiation: { mode } },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fixture],
    env: { ...process.env, ...(fail ? { KINTSUGI_TEST_FAILURE: "1", KINTSUGI_TEST_ERROR_MESSAGE: "TEST-private-token" } : {}) },
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

describe("member stdio MCP process", () => {
  it.each(["legacy", "auto"] as const)("initializes and serves explicit read-only context with %s negotiation", async (mode) => {
    const client = await connect(mode);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();

    expect(names).toEqual(["document_get", "document_tree", "project_list"]);
    expect(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    const documentTool = listed.tools.find((tool) => tool.name === "document_get");
    expect(documentTool?.inputSchema.required).toEqual(expect.arrayContaining(["projectId", "path"]));

    const first = await client.callTool({ name: "document_get", arguments: { projectId: "shop", path: "01-standards/a.md" } });
    expect(first.isError).not.toBe(true);
    const data = first.structuredContent as Record<string, unknown>;
    expect(data).toMatchObject({ projectId: "shop", path: "01-standards/a.md", content: "shop:01-standards/a.md" });
    const text = first.content.find((part) => part.type === "text");
    expect(text?.type === "text" ? JSON.parse(text.text) : null).toEqual(data);

    const second = await client.callTool({ name: "document_get", arguments: { projectId: "other", path: "00-project/b.md" } });
    expect(second.structuredContent).toMatchObject({ projectId: "other", content: "other:00-project/b.md" });
  });

  it("rejects calls that omit the project before reaching the adapter", async () => {
    const client = await connect("legacy");
    const result = await client.callTool({ name: "document_get", arguments: { path: "a.md" } });
    expect(result.isError).toBe(true);
  });

  it("rejects malformed selectors before calling a read tool", async () => {
    const client = await connect("legacy");
    const result = await client.callTool({ name: "document_get", arguments: { projectId: "Not A Project", path: "a.md" } });
    expect(result.isError).toBe(true);
  });

  it("maps adapter errors to stable codes without exposing messages", async () => {
    const client = await connect("legacy", true);
    const result = await client.callTool({ name: "project_list", arguments: {} });
    expect(result.isError).toBe(true);
    const text = result.content.filter((part) => part.type === "text").map((part) => part.type === "text" ? part.text : "").join("\n");
    expect(text).toContain("TOKEN_EXPIRED");
    expect(JSON.stringify(result)).not.toContain("TEST-private-token");
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
