// MCP servers inside a kernel job (ADR-0047): an agent reaches only the servers it names, only
// over HTTP from the JobSpec, and only the tools its server marks read-only or the admin allowed.

import { fauxAssistantMessage, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai";
import type { JobEvent, JobSpec, McpServerSpec } from "@kintsugi/runtime-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeMcpServer } from "../src/catalog/mcp-probe.js";
import { agent, createWorkspace, fauxRuntime, jobSpec, runJob } from "./helpers.js";
import { MCP_TOKEN, startFakeMcpServer, type FakeMcpServer } from "./support/mcp-server.js";

const workspace = createWorkspace();
let server: FakeMcpServer;
beforeAll(async () => {
  server = await startFakeMcpServer();
});
afterAll(async () => {
  await server.close();
  workspace.remove();
});

const docs = (over: Partial<McpServerSpec> = {}): McpServerSpec => ({ name: "docs", url: server.url, headers: { Authorization: `Bearer ${MCP_TOKEN}` }, timeoutSec: 10, allowedTools: [], ...over });

async function runWith(tools: string[], calls: ReturnType<typeof fauxToolCall>[], servers: McpServerSpec[]): Promise<{ events: JobEvent[]; seen: string }> {
  let seen = "";
  const steps: FauxResponseFactory[] = [
    () => fauxAssistantMessage(calls, { stopReason: "toolUse" }),
    (context) => {
      seen = JSON.stringify(context.messages);
      return fauxAssistantMessage("done");
    },
  ];
  const runtime = await fauxRuntime(steps);
  const spec: JobSpec = { ...jobSpec(workspace, agent(tools)), mcp: { servers } };
  const { events, done } = await runJob(runtime, spec);
  expect(done, done.type === "job.failed" ? done.error : "").toMatchObject({ type: "job.completed" });
  return { events, seen };
}

describe("probeMcpServer", () => {
  it("lists a server's tools with their read-only hint", async () => {
    const probe = await probeMcpServer({ url: server.url, headers: { Authorization: `Bearer ${MCP_TOKEN}` } });
    expect(probe.serverName).toBe("fake-docs");
    expect(probe.tools.map((tool) => [tool.name, tool.readOnly])).toEqual([["lookup", true], ["create_issue", false], ["export_all", false]]);
  });

  it("fails with a short message when the server refuses the credentials", async () => {
    await expect(probeMcpServer({ url: server.url, headers: { Authorization: "Bearer wrong" } })).rejects.toThrow();
  });
});

describe("MCP tools from a codemode script", () => {
  it("runs a read-only tool, refuses a tool that is not, and runs one the administrator allowed", async () => {
    server.calls.length = 0;
    const script = [
      'const found = await tools.mcp__docs__lookup({ q: "billing" });',
      "text(JSON.stringify(found.content));",
      'try { await tools.mcp__docs__create_issue({ title: "x" }); text("ISSUE CREATED"); } catch (error) { text("create refused"); }',
      'const all = await tools.mcp__docs__export_all({}); text(JSON.stringify(all.content));',
    ].join("\n");
    const { seen } = await runWith(["read", "codemode", "mcp__docs__*"], [fauxToolCall("codemode", { code: script }, { id: "c1" })], [docs({ allowedTools: ["export_*"] })]);
    expect(seen).toContain("lookup answered");
    expect(seen).toContain("create refused");
    expect(seen).toContain("export_all answered");
    expect(server.calls).toEqual(["lookup", "export_all"]);
  });

  it("sends the headers of the JobSpec to the server", async () => {
    expect(server.authorizations.filter((value) => value === `Bearer ${MCP_TOKEN}`).length).toBeGreaterThan(0);
  });
});

describe("MCP tools declared to the model (an agent without codemode)", () => {
  it("lets the model call a read-only tool and blocks the one that is not", async () => {
    server.calls.length = 0;
    const { events } = await runWith(
      ["read", "mcp__docs__*"],
      [fauxToolCall("mcp__docs__lookup", { q: "invoices" }, { id: "d1" }), fauxToolCall("mcp__docs__create_issue", { title: "x" }, { id: "d2" })],
      [docs()],
    );
    expect(server.calls).toEqual(["lookup"]);
    const blocked = events.filter((event): event is Extract<JobEvent, { type: "tool.call" }> => event.type === "tool.call" && event.decision === "blocked");
    expect(blocked.map((event) => event.tool)).toEqual(["mcp__docs__create_issue"]);
  });
});

describe("what a job may be given", () => {
  it("refuses an agent that names a server the job does not have", async () => {
    const runtime = await fauxRuntime([fauxAssistantMessage("never")]);
    await expect(runJob(runtime, { ...jobSpec(workspace, agent(["read", "mcp__tracker__*"])), mcp: { servers: [docs()] } })).rejects.toThrow(/MCP server "tracker".*not given/);
  });

  it("refuses a header value pi would interpret as a command", async () => {
    const runtime = await fauxRuntime([fauxAssistantMessage("never")]);
    await expect(runJob(runtime, { ...jobSpec(workspace, agent(["read", "mcp__docs__*"])), mcp: { servers: [docs({ headers: { Authorization: "!cat /etc/passwd" } })] } })).rejects.toThrow(/header "Authorization"/);
  });
});
