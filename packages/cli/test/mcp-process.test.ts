import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  it.each([false, true])("serves protocol calls and observes revocation; first-use browser auth: %s", async (browserAuth) => {
    directory = await mkdtemp(join(tmpdir(), "kintsugi-cli-mcp-"));
    const tokenFile = join(directory, "token");
    await writeFile(tokenFile, browserAuth ? "" : "TEST-mcp-process-token");
    const bearer = browserAuth ? "knt_caw_process-test" : "TEST-mcp-process-token";
    let tokenExchanges = 0;
    let requestCount = 0;
    const observedAuthorizations: Array<string | undefined> = [];
    let revoked = false;
    const api = createServer((request, response) => {
      if (request.url === "/api/auth/coding-agent/token") {
        tokenExchanges++;
        expect(request.headers["x-kintsugi-csrf"]).toBe("1");
        expect(request.headers.cookie).toBeUndefined();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ success: true, data: { accessToken: bearer, refreshToken: "knt_crt_process-test", expiresIn: 300, connectionId: "test-connection", projectIds: ["shop"] } }));
        return;
      }
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
      // Isolate one process: auto negotiation creates a disposable sibling whose stderr is discarded.
      { versionNegotiation: { mode: "legacy" } },
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fixture],
      env: {
        ...process.env,
        KINTSUGI_TEST_BASE_URL: "http://127.0.0.1:" + address.port,
        KINTSUGI_TEST_TOKEN_FILE: tokenFile,
        KINTSUGI_TEST_BROWSER_AUTH: browserAuth ? "1" : "0",
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (value) => { stderr += String(value); });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toContain("project_list");
      const first = await client.callTool({ name: "project_list", arguments: {} });
      expect(first.isError).not.toBe(true);
      expect(first.structuredContent).toMatchObject({ items: [{ projectId: "shop" }] });
      expect(observedAuthorizations).toEqual([`Bearer ${bearer}`]);
      expect(requestCount).toBe(1);
      expect(tokenExchanges, stderr).toBe(browserAuth ? 1 : 0);
      if (browserAuth) {
        expect(stderr).toContain("Sign in to Kintsugi");
        const envelope = await readFile(tokenFile, "utf8");
        expect(envelope).toContain("knt_crt_process-test");
        expect(envelope).not.toContain(bearer);
      }
      expect(stderr).not.toContain(bearer);
      expect(stderr).not.toContain("knt_crt_process-test");

      revoked = true;
      const afterRevocation = await client.callTool({ name: "project_list", arguments: {} });
      expect(afterRevocation.isError).toBe(true);
      expect(JSON.stringify(afterRevocation)).toContain("TOKEN_REVOKED");
      expect(JSON.stringify(afterRevocation)).not.toContain("TEST-mcp-process-token");
      expect(observedAuthorizations).toEqual([`Bearer ${bearer}`, `Bearer ${bearer}`]);
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
