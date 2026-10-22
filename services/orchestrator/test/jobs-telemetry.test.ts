// The telemetry of agent jobs (ADR-0048): the spans an agent attempt reports are stored with the
// agent, provider, model and attempt they belong to, and the cache and compaction counts reach the
// step's usage summary. The mock backend reports the same shape as pi, with fixed numbers.

import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { interpretersFromEnv } from "@kintsugi/runtime/launcher";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";
import { DEFAULT_GATE_DECIDER } from "../src/jobs/model.js";
import { JobRunner } from "../src/jobs/runner.js";
import { LocalCheckouts, MemoryJobStore, fixtureRepository, writingAgentRuntime } from "./support/jobs.js";

describe("telemetry of an agent job", () => {
  let legacy: ReturnType<typeof fixtureRepository>;
  let docs: ReturnType<typeof fixtureRepository>;
  let dataDir: string;
  let storage: CheckoutStorage;

  beforeAll(async () => {
    legacy = fixtureRepository({ "src/main.c": "int main(void) { return 0; }\n" });
    docs = fixtureRepository({ "kintsugi.yaml": "version: 1\nproject: { id: demo }\n" });
    dataDir = mkdtempSync(join(tmpdir(), "kintsugi-telemetry-data-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
  });
  afterAll(async () => {
    await legacy?.remove();
    await docs?.remove();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("stores every span of the attempt with its agent, model and attempt, and sums cache tokens into the usage", async () => {
    const store = new MemoryJobStore();
    store.legacy = { demo: "legacy" };
    const runner = new JobRunner({
      store,
      gates: DEFAULT_GATE_DECIDER,
      storage,
      checkouts: new LocalCheckouts({ legacy: legacy.bare, docs: docs.bare }),
      agents: writingAgentRuntime({ "legacy-analyst": () => ({}) }),
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      requestWrite: async () => undefined,
      log: () => undefined,
    });
    const id = randomUUID();
    await store.create({
      id,
      projectId: "demo",
      applicationId: "demo",
      kind: "agent",
      name: "legacy-analyst",
      sourceRepositoryId: "legacy",
      inputs: { task: "Look at the code.", limits: { maxTurns: 2 } },
    });
    const run = await runner.run(id);
    expect(run?.status).toBe("succeeded");

    const names = store.spans.map((entry) => entry.span.name);
    expect(names).toEqual(expect.arrayContaining(["kintsugi.job", "kintsugi.turn", "kintsugi.tool"]));
    expect(store.spans.filter((entry) => entry.span.name === "kintsugi.job")).toHaveLength(1);
    for (const entry of store.spans) {
      expect(entry).toMatchObject({ runId: id, projectId: "demo", applicationId: "demo", provider: "mock", model: "mock", attempt: 1 });
      expect(entry.agent).toMatch(/^legacy-analyst@/);
    }
    // Spans of one attempt form a tree: every parent is a span of the same attempt.
    const ids = new Set(store.spans.map((entry) => entry.span.id));
    for (const entry of store.spans) if (entry.span.parentId !== undefined) expect(ids.has(entry.span.parentId)).toBe(true);

    const usage = (run?.outputSummary as { usage: Record<string, number> }).usage;
    expect(usage).toMatchObject({ cacheReadTokens: expect.any(Number), cacheWriteTokens: 0, compactions: 0 });
    expect(usage["cacheReadTokens"]).toBeGreaterThan(0);
  });
});
