// MCP servers in agent jobs (ADR-0047): the worker resolves the servers an agent names in its tools
// and hands them to the job; an agent that names none gets none, and a server that cannot be
// resolved fails the step before the model is called.

import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { interpretersFromEnv, removeTree } from "@kintsugi/runtime/launcher";
import type { AgentDefinition, McpServerSpec } from "@kintsugi/runtime-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentResolver } from "../src/jobs/agents.js";
import { DEFAULT_GATE_DECIDER } from "../src/jobs/model.js";
import { JobRunner } from "../src/jobs/runner.js";
import { LocalCheckouts, MemoryJobStore, fixtureRepository, writingAgentRuntime } from "./support/jobs.js";

const tracker: McpServerSpec = { name: "tracker", url: "http://127.0.0.1:9/mcp", headers: { Authorization: "Bearer x" }, timeoutSec: 30, allowedTools: ["create_*"] };

describe("MCP servers of an agent job", () => {
  let legacy: ReturnType<typeof fixtureRepository>;
  let docs: ReturnType<typeof fixtureRepository>;
  let dataDir: string;
  let storage: CheckoutStorage;

  beforeAll(async () => {
    legacy = fixtureRepository({ "src/main.c": "int main(void) { return 0; }\n" });
    docs = fixtureRepository({ "kintsugi.yaml": "version: 1\nproject: { id: demo }\n" });
    dataDir = mkdtempSync(join(tmpdir(), "kintsugi-mcp-data-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
  });
  afterAll(async () => {
    await legacy?.remove();
    await docs?.remove();
    await removeTree(dataDir);
  });

  const definition = (tools: string[]): AgentResolver => ({
    definition: async (name): Promise<AgentDefinition> => ({ id: name, version: "1.0.0", instructions: "Look at the code.", tools }),
  });

  async function run(tools: string[], mcpServers?: (ids: readonly string[]) => Promise<McpServerSpec[]>) {
    const store = new MemoryJobStore();
    const agents = writingAgentRuntime({ "tracker-agent": () => ({}) });
    const runner = new JobRunner({
      store,
      gates: DEFAULT_GATE_DECIDER,
      storage,
      checkouts: new LocalCheckouts({ legacy: legacy.bare, docs: docs.bare }),
      agents,
      agentDefinitions: definition(tools),
      ...(mcpServers === undefined ? {} : { mcpServers }),
      interpreters: interpretersFromEnv(),
      requestWrite: async () => undefined,
      log: () => undefined,
    });
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "agent", name: "tracker-agent", sourceRepositoryId: "legacy", inputs: { task: "Look.", limits: { maxTurns: 1 } } });
    return { result: await runner.run(id), agents };
  }

  it("resolves the servers an agent names and gives them to the job", async () => {
    const asked: string[][] = [];
    const { result, agents } = await run(["read", "mcp__tracker__*"], async (ids) => {
      asked.push([...ids]);
      return [tracker];
    });
    expect(result?.status).toBe("succeeded");
    expect(asked).toEqual([["tracker"]]);
    expect(agents.specs[0]?.mcp).toEqual({ servers: [tracker] });
  });

  it("gives no MCP to an agent that names no server, and does not ask the registry", async () => {
    let asked = 0;
    const { result, agents } = await run(["read", "codemode"], async () => {
      asked += 1;
      return [];
    });
    expect(result?.status).toBe("succeeded");
    expect(asked).toBe(0);
    expect(agents.specs[0]?.mcp).toBeUndefined();
  });

  it("fails the step before the model when a named server cannot be resolved", async () => {
    const { result, agents } = await run(["read", "mcp__tracker__*"], async () => {
      throw new Error('MCP server "tracker" is not registered or is disabled (Settings → MCP servers)');
    });
    expect(result?.status).toBe("failed");
    expect(result?.failureReason).toMatch(/not registered or is disabled/);
    expect(agents.specs).toHaveLength(0);
  });

  it("fails the step when the worker has no registry at all", async () => {
    const { result } = await run(["read", "mcp__tracker__*"]);
    expect(result?.status).toBe("failed");
    expect(result?.failureReason).toMatch(/no MCP registry/);
  });
});
