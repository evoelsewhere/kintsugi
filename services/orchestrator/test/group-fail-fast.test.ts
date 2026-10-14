// A parallel group stops at its first failure: the siblings still running are aborted and the ones
// not yet started are never started, and the stage reports the step that really failed.

import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StagePlanExecutor, type LeafResult, type LeafRun } from "../src/jobs/executor.js";
import type { AgentStep, StagePlan } from "../src/jobs/plan.js";

let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

const agent = (id: string): AgentStep => ({ id, kind: "agent", agent: "legacy-analyst", task: `do ${id}` });

async function runGroup(): Promise<{ error: string | undefined; started: string[]; aborted: string[] }> {
  root = await mkdtemp(join(tmpdir(), "group-"));
  const dirs = { root, in: join(root, "in"), work: join(root, "work"), out: join(root, "out") };
  for (const dir of [dirs.in, dirs.work, dirs.out]) await mkdir(dir, { recursive: true });
  const plan: StagePlan = {
    id: "demo",
    message: () => "demo",
    steps: [{ id: "group", kind: "parallel", steps: [agent("a"), agent("b"), agent("c")] }],
  };
  const started: string[] = [];
  const aborted: string[] = [];
  const runLeaf = async (spec: LeafRun, _placement: unknown, abort?: AbortSignal): Promise<LeafResult> => {
    const task = String(spec.inputs["task"]);
    started.push(task);
    if (task === "do a") {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { id: task, ok: false, reason: "boom" };
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      abort?.addEventListener("abort", () => {
        clearTimeout(timer);
        aborted.push(task);
        resolve();
      });
    });
    return abort?.aborted === true ? { id: task, ok: false, reason: "aborted" } : { id: task, ok: true, summary: {}, agents: 1 };
  };
  const executor = new StagePlanExecutor({
    plan,
    run: { id: "r", projectId: "p" },
    values: { app: "demo", repo: "legacy", commit: "abc" },
    dirs,
    limits: { maxAgents: 10, concurrency: 3 },
    gates: { decide: async (_request: unknown, fallback: string) => fallback } as never,
    runLeaf,
    log: async () => undefined,
  });
  try {
    await executor.run();
    return { error: undefined, started, aborted };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), started, aborted };
  }
}

describe("parallel group", () => {
  it("aborts the running siblings and reports the failed step", async () => {
    const { error, aborted } = await runGroup();
    expect(error).toMatch(/^Step group failed: a: boom/);
    expect(aborted.sort()).toEqual(["do b", "do c"]);
  });
});
