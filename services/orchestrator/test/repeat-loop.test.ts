// A repeat step runs a fan-out in rounds until its condition holds. Without `max` it ends when the condition holds,
// when the stage's agent cap leaves no job for another round, or when a round starts no job.

import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StagePlanExecutor, type LeafPlacement, type LeafResult, type LeafRun } from "../src/jobs/executor.js";
import type { AgentStep, RepeatStep, StagePlan } from "../src/jobs/plan.js";

let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

const worker: AgentStep = { id: "work", kind: "agent", agent: "legacy-analyst", task: "work on {key}" };

async function run(options: { until: (round: number) => boolean; max?: number; maxAgents?: number; items?: string[] }): Promise<{ keys: string[]; logs: string[]; agents: number }> {
  root = await mkdtemp(join(tmpdir(), "repeat-"));
  const dirs = { root, in: join(root, "in"), work: join(root, "work"), out: join(root, "out") };
  for (const dir of [dirs.in, dirs.work, dirs.out]) await mkdir(dir, { recursive: true });
  const items = options.items ?? ["a", "b"];
  const loop: RepeatStep = {
    id: "loop",
    kind: "repeat",
    ...(options.max === undefined ? {} : { max: options.max }),
    steps: [{ id: "each", kind: "forEach", items: async () => items.map((key) => ({ key, item: key })), step: worker }],
    until: (ctx) => options.until(ctx.round),
  };
  const plan: StagePlan = { id: "demo", message: () => "demo", steps: [loop] };
  const keys: string[] = [];
  const logs: string[] = [];
  const runLeaf = async (_spec: LeafRun, placement: LeafPlacement & { key?: string }): Promise<LeafResult> => {
    keys.push(placement.key ?? "");
    return { id: placement.key ?? "", ok: true, summary: {}, agents: 1 };
  };
  const executor = new StagePlanExecutor({
    plan,
    run: { id: "r", projectId: "p" },
    values: { app: "demo", sources: `legacy@${"a".repeat(40)}` },
    dirs,
    limits: { maxAgents: options.maxAgents ?? 100, concurrency: 2 },
    gates: { decide: async (_request: unknown, fallback: string) => fallback } as never,
    runLeaf,
    log: async (message) => {
      logs.push(message);
    },
  });
  const outcome = await executor.run();
  return { keys, logs, agents: outcome.agents };
}

describe("repeat with a fan-out", () => {
  it("runs the fan-out again each round, keyed by round, until the condition holds, without a round limit", async () => {
    const { keys, logs } = await run({ until: (round) => round === 3 });
    expect(keys.sort()).toEqual(["each#a@1", "each#a@2", "each#a@3", "each#b@1", "each#b@2", "each#b@3"].map((key) => key.replace("each", "work")).sort());
    expect(logs.some((line) => line.includes("done after round 3"))).toBe(true);
  });

  it("stops at the stage agent cap instead of failing", async () => {
    const { keys, logs, agents } = await run({ until: () => false, maxAgents: 5 });
    expect(agents).toBe(5);
    expect(keys.length).toBe(5);
    expect(logs.some((line) => line.includes("agent cap"))).toBe(true);
  });

  it("stops when a round starts no job", async () => {
    const { keys, logs } = await run({ until: () => false, items: [] });
    expect(keys).toEqual([]);
    expect(logs.some((line) => line.includes("started no agent job"))).toBe(true);
  });

  it("still honours max", async () => {
    const { keys } = await run({ until: () => false, max: 2 });
    expect(keys.length).toBe(4);
  });
});
