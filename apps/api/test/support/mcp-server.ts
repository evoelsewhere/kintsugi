// A minimal MCP server over Streamable HTTP for tests: JSON-RPC answers as plain JSON, a bearer
// token, three tools (one marked read-only, one not, one not but allowed by the tests' pattern)
// and a record of every call that reached it.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const MCP_TOKEN = "secret-token-123";

const TOOLS = [
  { name: "lookup", description: "Look something up", inputSchema: { type: "object", properties: { q: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "create_issue", description: "Create an issue", inputSchema: { type: "object", properties: { title: { type: "string" } } } },
  { name: "export_all", description: "Export everything", inputSchema: { type: "object", properties: {} } },
];

export interface FakeMcpServer {
  url: string;
  /** Names of the tools called, in order. */
  calls: string[];
  /** Authorization headers seen on requests. */
  authorizations: Array<string | undefined>;
  close(): Promise<void>;
}

export async function startFakeMcpServer(): Promise<FakeMcpServer> {
  const calls: string[] = [];
  const authorizations: Array<string | undefined> = [];
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (part) => (body += part));
    request.on("end", () => {
      authorizations.push(request.headers["authorization"]);
      if (request.headers["authorization"] !== `Bearer ${MCP_TOKEN}`) {
        response.writeHead(401, { "content-type": "text/plain" }).end("unauthorized");
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const message = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> };
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const reply = (result: unknown): void => {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      };
      if (message.method === "initialize") {
        reply({ protocolVersion: (message.params?.["protocolVersion"] as string) ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-docs", version: "1.0.0" }, instructions: "Documentation lookups." });
      } else if (message.method === "tools/list") {
        reply({ tools: TOOLS });
      } else if (message.method === "tools/call") {
        const name = String(message.params?.["name"]);
        calls.push(name);
        const args = (message.params?.["arguments"] ?? {}) as Record<string, unknown>;
        reply({ content: [{ type: "text", text: `${name} answered ${JSON.stringify(args)}` }], isError: false });
      } else {
        reply({});
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
    calls,
    authorizations,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
