// MCP end to end in a child process under Node's permission model: the job's spec carries one HTTP
// MCP server (with its bearer token), the model (a local OpenAI-compatible server) answers with a
// codemode script, and the script reaches the MCP server through the kernel: a read-only tool runs
// with the header from the spec, a tool the server does not mark read-only is refused (ADR-0047).

import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createChildAgentRuntime } from "@kintsugi/runtime/launcher";
import type { AgentDefinition, JobEvent, JobSpec } from "@kintsugi/runtime-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_TOKEN, startFakeMcpServer, type FakeMcpServer } from "./support/mcp-server.js";

const SCRIPT = [
  'const found = await tools.mcp__docs__lookup({ q: "billing" });',
  "text(JSON.stringify(found.content));",
  'try { await tools.mcp__docs__create_issue({ title: "x" }); text("ISSUE CREATED"); } catch (error) { text("create refused"); }',
].join("\n");

describe("an MCP job in a child process", () => {
  let root: string;
  let server: Server;
  let mcp: FakeMcpServer;
  const requests: Array<{ messages: Array<{ role: string; content?: unknown }> }> = [];

  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "kintsugi-mcp-e2e-"));
    mcp = await startFakeMcpServer();
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (part) => (body += part));
      request.on("end", () => {
        const parsed = JSON.parse(body) as { messages: Array<{ role: string; content?: unknown }> };
        requests.push(parsed);
        response.writeHead(200, { "content-type": "text/event-stream" });
        if (parsed.messages.some((message) => message.role === "tool")) {
          response.write(chunk({ role: "assistant", content: "all done" }, null));
          response.write(chunk({}, "stop"));
        } else {
          const call = { index: 0, id: "call_1", type: "function", function: { name: "codemode", arguments: JSON.stringify({ code: SCRIPT }) } };
          response.write(chunk({ role: "assistant", tool_calls: [call] }, null));
          response.write(chunk({}, "tool_calls"));
        }
        response.write("data: [DONE]\n\n");
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(async () => {
    server.close();
    await mcp.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("lets a script call a read-only tool of the MCP server with the header of the spec, and refuses the other", async () => {
    const job = join(root, "job");
    for (const dir of ["src", "in", "out", "tmp"]) mkdirSync(join(job, dir), { recursive: true });
    writeFileSync(join(job, "src", "notes.txt"), "notes\n");
    const agent: AgentDefinition = { id: "scripted", version: "1.0.0", instructions: "Use codemode.", tools: ["read", "codemode", "mcp__docs__*"] };
    const spec: JobSpec = {
      agent,
      task: "Look the billing topic up.",
      model: { provider: "local", id: "m" },
      workspace: { readOnly: [join(job, "src")], outDir: join(job, "out") },
      limits: { timeoutSec: 90 },
      mcp: { servers: [{ name: "docs", url: mcp.url, headers: { Authorization: `Bearer ${MCP_TOKEN}` }, timeoutSec: 20, allowedTools: [] }] },
    };
    const runtime = createChildAgentRuntime({
      mode: "pi",
      loadProvider: async () => ({
        config: { kind: "custom", id: "local", enabled: true, auth: { type: "none" }, api: "openai-completions", baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, models: [{ id: "m" }] },
        credentials: { env: {}, secrets: {} },
      }),
    });
    const handle = await runtime.startJob(spec);
    const events: JobEvent[] = [];
    for await (const event of handle.events) events.push(event);
    const done = await handle.done;
    expect(done, done.type === "job.failed" ? done.error : "").toMatchObject({ type: "job.completed" });

    const result = String(requests[1]?.messages.find((message) => message.role === "tool")?.content);
    expect(result).toContain("lookup answered");
    expect(result).toContain("create refused");
    expect(result).not.toContain("ISSUE CREATED");
    // Only the read-only tool reached the server, and with the bearer token the spec carried.
    expect(mcp.calls).toEqual(["lookup"]);
    expect(mcp.authorizations.every((value) => value === `Bearer ${MCP_TOKEN}`)).toBe(true);

    const spans = events.flatMap((event) => (event.type === "span" ? [event.span] : []));
    expect(spans.some((span) => span.name === "kintsugi.codemode")).toBe(true);
    expect(spans.find((span) => span.name === "kintsugi.mcp")).toMatchObject({ attributes: { server: "docs", nested: true } });
  }, 120_000);
});
