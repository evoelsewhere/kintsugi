// The telemetry of agent jobs (ADR-0048): the spans an agent attempt reports are stored with the
// agent, provider, model and attempt they belong to, and the cache and compaction counts reach the
// step's usage summary. The mock backend reports the same shape as pi, with fixed numbers.

import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { interpretersFromEnv, removeTree } from "@kintsugi/runtime/launcher";
import type { AgentRuntime, JobEvent, JobHandle, JobSpan } from "@kintsugi/runtime-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";
import { AttemptSpans } from "../src/jobs/attempt-spans.js";
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
    await removeTree(dataDir);
  });

  it("stores every span of the attempt with its agent, model and attempt, and sums cache tokens into the usage", async () => {
    const store = new MemoryJobStore();
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

  /** A runtime whose job reports two settled turns and then ends as `end`, with or without its root span. */
  function stoppingRuntime(end: Extract<JobEvent, { type: "job.completed" | "job.failed" }>, sendsRoot: boolean): AgentRuntime {
    const turn = (index: number): JobSpan => ({
      id: `turn-${index}`,
      parentId: "root-1",
      name: "kintsugi.turn",
      startedAt: new Date().toISOString(),
      durationMs: 1000,
      status: "ok",
      attributes: { turn: index, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50, cacheWriteTokens: 0, costUsd: 0.25, contextPercent: 10 * index },
    });
    const root: JobSpan = { id: "root-1", name: "kintsugi.job", startedAt: new Date().toISOString(), durationMs: 2000, status: "error", attributes: { turns: 2, outcome: "loop" } };
    return {
      // A mock engine: the runner then needs no model binding.
      engine: "mock@stopping",
      async startJob(spec): Promise<JobHandle> {
        const jobId = randomUUID();
        const events: JobEvent[] = [
          { type: "job.started", jobId, at: new Date().toISOString(), runtimeVersion: "0", agent: `${spec.agent.id}@${spec.agent.version}` },
          { type: "span", jobId, span: turn(1) },
          { type: "span", jobId, span: turn(2) },
          ...(sendsRoot ? [{ type: "span" as const, jobId, span: root }] : []),
          { ...end, jobId },
        ];
        return {
          jobId,
          events: (async function* () {
            yield* events;
          })(),
          abort: async () => undefined,
          done: Promise.resolve({ ...end, jobId }),
        };
      },
    };
  }

  async function runWith(agents: AgentRuntime): Promise<{ status: string | undefined; roots: { span: JobSpan; attempt: number }[] }> {
    const store = new MemoryJobStore();
    const runner = new JobRunner({
      store,
      gates: DEFAULT_GATE_DECIDER,
      storage,
      checkouts: new LocalCheckouts({ legacy: legacy.bare, docs: docs.bare }),
      agents,
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      requestWrite: async () => undefined,
      log: () => undefined,
    });
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "agent", name: "legacy-analyst", sourceRepositoryId: "legacy", inputs: { task: "Look at the code.", disableStalledRetry: true } });
    const run = await runner.run(id);
    return { status: run?.status, roots: store.spans.filter((entry) => entry.span.name === "kintsugi.job").map((entry) => ({ span: entry.span, attempt: entry.attempt })) };
  }

  it("records the root span of an attempt that was stopped before the kernel could send it, with what its turns spent (T2-008)", async () => {
    const at = new Date().toISOString();
    const stopped = await runWith(stoppingRuntime({ type: "job.failed", jobId: "", at, reason: "aborted", error: "the worker is stopping" }, false));
    expect(stopped.status).toBe("failed");
    expect(stopped.roots).toHaveLength(1);
    expect(stopped.roots[0]!.span).toMatchObject({
      id: "root-1",
      status: "error",
      error: "the worker is stopping",
      attributes: { agent: "legacy-analyst", turns: 2, inputTokens: 2000, outputTokens: 400, cacheReadTokens: 100, costUsd: 0.5, contextPeakPercent: 20, outcome: "stopped", recordedBy: "worker" },
    });
    const crashed = await runWith(stoppingRuntime({ type: "job.failed", jobId: "", at, reason: "error", error: "the agent process exited with code 1 without a result" }, false));
    expect(crashed.roots.map((root) => root.span.attributes["outcome"])).toEqual(["error"]);
  });

  it("adds no root span when the kernel sent one", async () => {
    const { roots } = await runWith(stoppingRuntime({ type: "job.failed", jobId: "", at: new Date().toISOString(), reason: "loop", error: "stopped: glob was called with the same arguments 12 times" }, true));
    expect(roots).toHaveLength(1);
    expect(roots[0]!.span.attributes).toEqual({ turns: 2, outcome: "loop" });
  });
});

describe("the spans an attempt settled", () => {
  const span = (name: string, attributes: JobSpan["attributes"], extra: Partial<JobSpan> = {}): JobSpan => ({ id: randomUUID(), parentId: "root", name, startedAt: new Date().toISOString(), durationMs: 1, status: "ok", attributes, ...extra });
  const labels = { agent: "a", agentVersion: "1", provider: "p", model: "m" };
  const cancelled = { type: "job.failed" as const, jobId: "j", at: new Date().toISOString(), reason: "aborted" as const, error: "cancelled" };

  it("count compaction summaries and successful compactions, and ignore tool spans", () => {
    const settled = new AttemptSpans();
    settled.add(span("kintsugi.turn", { inputTokens: 10, outputTokens: 1, costUsd: 0.1 }));
    settled.add(span("kintsugi.tool", { tool: "read" }));
    settled.add(span("kintsugi.compaction", { summaryInputTokens: 5, summaryOutputTokens: 2, summaryCostUsd: 0.05, aborted: false }));
    settled.add(span("kintsugi.compaction", { aborted: true }));
    expect(settled.missingRoot(cancelled, "cancelled", labels, "cancelled")).toMatchObject({
      id: "root",
      status: "error",
      attributes: { turns: 1, inputTokens: 15, outputTokens: 3, compactions: 1, outcome: "cancelled" },
    });
    expect(settled.missingRoot(cancelled, "cancelled", labels)?.attributes["costUsd"]).toBeCloseTo(0.15);
  });

  it("give an attempt that settled nothing a root of its own", () => {
    const root = new AttemptSpans().missingRoot(cancelled, "cancelled", labels, "cancelled");
    expect(root?.id).toEqual(expect.any(String));
    expect(root?.attributes).toMatchObject({ turns: 0, inputTokens: 0, outcome: "cancelled" });
  });
});
