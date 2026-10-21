import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

const fixture = fileURLToPath(new URL("./fixtures/cli-mcp-server.mjs", import.meta.url));
let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("compiled CLI MCP bridge process", () => {
  it("serves protocol calls through the selected installation and observes server-side revocation per call", async () => {
    directory = await mkdtemp(join(tmpdir(), "kintsugi-cli-mcp-"));
    const tokenFile = join(directory, "token");
    await writeFile(tokenFile, "TEST-mcp-process-token");
    let requestCount = 0;
    const observedAuthorizations: Array<string | undefined> = [];
    let revoked = false;
    const api = createServer((request, response) => {
      requestCount += 1;
      observedAuthorizations.push(request.headers.authorization);
      response.writeHead(revoked ? 401 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify(revoked ? {
        success: false,
        statusCode: 401,
        error: "Unauthorized",
        message: "Credential revoked",
        details: { code: "TOKEN_REVOKED" },
        timestamp: "2026-10-21T00:00:00.000Z",
        path: "/api/member/v1/projects",
      } : {
        success: true,
        data: { schemaVersion: "1", items: [{ projectId: "shop", name: "Shop" }], limit: 25 },
      }));
    });
    api.listen(0, "127.0.0.1");
    await once(api, "listening");
    const address = api.address();
    if (address === null || typeof address === "string") throw new Error("No local API port");

    const client = new Client(
      { name: "kintsugi-cli-integration-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fixture],
      env: {
        ...process.env,
        KINTSUGI_TEST_BASE_URL: "http://127.0.0.1:" + address.port,
        KINTSUGI_TEST_TOKEN_FILE: tokenFile,
      },
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toContain("project_list");
      const first = await client.callTool({ name: "project_list", arguments: {} });
      expect(first.isError).not.toBe(true);
      expect(first.structuredContent).toMatchObject({ items: [{ projectId: "shop" }] });
      expect(observedAuthorizations).toEqual(["Bearer TEST-mcp-process-token"]);
      expect(requestCount).toBe(1);

      revoked = true;
      const afterRevocation = await client.callTool({ name: "project_list", arguments: {} });
      expect(afterRevocation.isError).toBe(true);
      expect(JSON.stringify(afterRevocation)).toContain("TOKEN_REVOKED");
      expect(JSON.stringify(afterRevocation)).not.toContain("TEST-mcp-process-token");
      expect(observedAuthorizations).toEqual(["Bearer TEST-mcp-process-token", "Bearer TEST-mcp-process-token"]);
      expect(requestCount).toBe(2);
    } finally {
      await client.close().catch(() => undefined);
      const closed = once(api, "close");
      api.close();
      api.closeAllConnections();
      await closed;
    }
  });
});
