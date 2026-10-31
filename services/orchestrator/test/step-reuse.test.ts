// What makes a later attempt of a job skip a step (ADR-0055): the executor keeps a chain of everything that came
// before a step in the plan; a step runs again when its fingerprint (which includes the chain) changed, when it
// failed, or when what it wrote is no longer there. The ledger is the real one, the steps are fakes.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StagePlanExecutor, type LeafPlacement, type LeafResult, type LeafRun, type StepReuse } from "../src/jobs/executor.js";
import type { AgentStep, ScriptStep, StagePlan, StageStep } from "../src/jobs/plan.js";
import { Ledger, chainAfter, contributionOf, digestOf, filesDigest, stableStringify } from "../src/workspace/ledger.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "step-reuse-"));
  for (const dir of ["in", "work", "out", "state"]) await mkdir(join(root, dir), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const agent = (id: string, task = `do ${id}`): AgentStep => ({ id, kind: "agent", agent: "legacy-analyst", task });
const script = (id: string): ScriptStep => ({ id, kind: "script", script: "x.py", args: [id] });
const planOf = (steps: StageStep[]): StagePlan => ({ id: "demo", message: () => "demo", steps });

interface Attempt {
  ran: string[];
  reused: string[];
  error: string | undefined;
}

/** One attempt of a job: the agents "write" a file named after their task; `failOn` makes a step fail. */
async function attempt(ledger: Ledger, plan: StagePlan, options: { failOn?: string; cancelOn?: string; write?: boolean } = {}): Promise<Attempt> {
  const ran: string[] = [];
  const reused: string[] = [];
  const cancel = new AbortController();
  const runLeaf = async (spec: LeafRun, placement: LeafPlacement): Promise<LeafResult> => {
    const task = String(spec.inputs["task"] ?? spec.inputs["args"]);
    ran.push(placement.key ?? task);
    if (options.failOn !== undefined && (placement.key === options.failOn || task === options.failOn)) return { id: "x", ok: false, reason: "boom" };
    if (options.cancelOn !== undefined && placement.key === options.cancelOn) {
      // A person cancels the run while this step runs.
      cancel.abort(new Error("cancelled"));
      return { id: "x", ok: false, reason: "cancelled" };
    }
    const path = `${(placement.key ?? task).replace(/[^a-z0-9]+/gi, "-")}.md`;
    if (options.write !== false && spec.kind === "agent") await writeFile(join(placement.out, path), `# ${task}\n`);
    return { id: "x", ok: true, summary: {}, agents: spec.kind === "agent" ? 1 : 0, outputs: spec.kind === "agent" ? [{ path, zone: "out" }] : [], digest: filesDigest([{ path, sha256: digestOf(task) }]) };
  };
  const reuse: StepReuse = {
    fingerprint: async (spec, upstream) => digestOf({ kind: spec.kind, name: spec.name, inputs: spec.inputs, upstream }),
    settled: async (key, fingerprint) => {
      const entry = ledger.get(key);
      if (entry === undefined || entry.status !== "succeeded" || entry.fingerprint !== fingerprint) return undefined;
      for (const output of entry.outputs) if (!(await exists(join(root, output.zone, output.path)))) return undefined;
      return { digest: entry.digest };
    },
    record: (key, entry) => ledger.record(key, { ...entry, attempt: 1, finishedAt: "2026-10-22T00:00:00Z" }),
  };
  const executor = new StagePlanExecutor({
    plan,
    run: { id: "r", projectId: "p" },
    values: { app: "demo", sources: `legacy@${"a".repeat(40)}` },
    dirs: { root, in: join(root, "in"), work: join(root, "work"), out: join(root, "out") },
    limits: { maxAgents: 50, concurrency: 3 },
    gates: { decide: async (request: { default: string }) => ({ choice: request.default, defaulted: false, by: "test-user" }) } as never,
    runLeaf,
    signal: cancel.signal,
    reuse,
    gateChoices: ledger.gates(),
    onGate: (id, choice) => ledger.recordGate(id, choice),
    log: async (message, data) => {
      if (data?.["reused"] === true) reused.push(String(data["step"]));
    },
  });
  try {
    const outcome = await executor.run();
    for (const step of outcome.steps) if (step.reused === true) reused.push(step.id);
    return { ran, reused: [...new Set(reused)], error: undefined };
  } catch (error) {
    return { ran, reused: [...new Set(reused)], error: error instanceof Error ? error.message : String(error) };
  }
}

const exists = (path: string): Promise<boolean> => import("node:fs/promises").then((fs) => fs.stat(path).then(() => true, () => false));

describe("the upstream chain", () => {
  it("does not depend on the order of the members of a group, and depends on every contribution", () => {
    const a = contributionOf("a", "fa", "da");
    const b = contributionOf("b", "fb", "db");
    expect(chainAfter("start", [a, b])).toBe(chainAfter("start", [b, a]));
    expect(chainAfter("start", [a, b])).not.toBe(chainAfter("start", [a]));
    expect(chainAfter("start", [a])).not.toBe(chainAfter("other", [a]));
    expect(contributionOf("a", "fa", "da")).not.toBe(contributionOf("a", "fa", "changed"));
  });

  it("hashes equal values equal, whatever the order of their keys", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
    expect(digestOf({ x: 1, y: 2 })).toBe(digestOf({ y: 2, x: 1 }));
    expect(filesDigest([{ path: "b", sha256: "2" }, { path: "a", sha256: "1" }])).toBe(filesDigest([{ path: "a", sha256: "1" }, { path: "b", sha256: "2" }]));
  });
});

describe("reusing the steps of an earlier attempt", () => {
  const plan = (): StagePlan => planOf([script("scan"), agent("one"), agent("two"), { id: "each", kind: "forEach", items: async () => [{ key: "u1", item: "u1" }, { key: "u2", item: "u2" }], step: agent("unit", "unit {item}") }, agent("last")]);

  it("skips every agent step of an attempt that changed nothing, and runs the script again", async () => {
    const ledger = await Ledger.open(join(root, "state", "ledger.json"));
    const first = await attempt(ledger, plan());
    expect(first.error).toBeUndefined();
    expect(first.ran).toEqual(expect.arrayContaining(["scan", "one", "two", "unit#u1", "unit#u2", "last"]));
    const second = await attempt(ledger, plan());
    expect(second.error).toBeUndefined();
    expect(second.ran).toEqual(["scan"]);
    expect(second.reused.sort()).toEqual(["last", "one", "two", "unit"]);
  });

  it("runs a step and everything after it when its task changed, and nothing before it", async () => {
    const ledger = await Ledger.open(join(root, "state", "ledger.json"));
    await attempt(ledger, plan());
    const edited = planOf([script("scan"), agent("one"), agent("two", "do two, differently"), { id: "each", kind: "forEach", items: async () => [{ key: "u1", item: "u1" }, { key: "u2", item: "u2" }], step: agent("unit", "unit {item}") }, agent("last")]);
    const second = await attempt(ledger, edited);
    expect(second.ran).toEqual(expect.arrayContaining(["scan", "two", "unit#u1", "unit#u2", "last"]));
    expect(second.ran).not.toContain("one");
  });

  it("picks up where a failure stopped it: the steps before the failed one are reused, and the survivors of a failed group are kept", async () => {
    const ledger = await Ledger.open(join(root, "state", "ledger.json"));
    const first = await attempt(ledger, plan(), { failOn: "unit#u2" });
    expect(first.error).toMatch(/unit#u2|u2: boom|Step each failed/);
    // The member that succeeded wrote its file and it is in the stage's out/, not lost with the group.
    expect(await exists(join(root, "out", "unit-u1.md"))).toBe(true);
    const second = await attempt(ledger, plan());
    expect(second.error).toBeUndefined();
    expect(second.ran).toEqual(expect.arrayContaining(["scan", "unit#u2", "last"]));
    expect(second.ran).not.toContain("one");
    expect(second.ran).not.toContain("two");
    expect(second.ran).not.toContain("unit#u1");
  });

  it("picks up where a cancellation stopped it: what finished before it, in the group too, is kept and reused (ADR-0090)", async () => {
    const ledger = await Ledger.open(join(root, "state", "ledger.json"));
    const groupPlan = planOf([agent("one"), { id: "both", kind: "parallel", steps: [agent("left"), agent("right")] }, agent("last")]);
    const first = await attempt(ledger, groupPlan, { cancelOn: "right" });
    expect(first.error).toBeDefined();
    expect(await exists(join(root, "out", "left.md"))).toBe(true);
    const second = await attempt(ledger, groupPlan);
    expect(second.error).toBeUndefined();
    expect(second.ran).toEqual(["right", "last"]);
  });

  it("runs a step again when what it wrote is gone", async () => {
    const ledger = await Ledger.open(join(root, "state", "ledger.json"));
    await attempt(ledger, plan());
    await rm(join(root, "out", "two.md"));
    const second = await attempt(ledger, plan());
    expect(second.ran).toContain("two");
    expect(second.ran).not.toContain("one");
  });

  it("replays the choice taken at a gate instead of asking again, and a changed choice changes what follows", async () => {
    const ledger = await Ledger.open(join(root, "state", "ledger.json"));
    const withGate = planOf([agent("one"), { id: "which", kind: "gate", question: "Which?", options: ["a", "b"], default: "a", decisionMode: "required-human" }, agent("two")]);
    await attempt(ledger, withGate);
    expect(ledger.gates().get("which")).toBe("a");
    await ledger.recordGate("which", "b");
    const second = await attempt(ledger, withGate);
    // The recorded choice "b" is replayed, so the chain after the gate differs from the first attempt's and "two" runs again.
    expect(second.ran).toEqual(["two"]);
  });

  it("reads back what it recorded, and starts empty when the file is unreadable", async () => {
    const file = join(root, "state", "ledger.json");
    const ledger = await Ledger.open(file);
    await attempt(ledger, planOf([agent("one")]));
    const reopened = await Ledger.open(file);
    expect(reopened.get("one")).toMatchObject({ status: "succeeded", attempt: 1 });
    await writeFile(file, "{ not json");
    expect((await Ledger.open(file)).entries()).toEqual([]);
    await reopened.reset();
    expect(reopened.entries()).toEqual([]);
  });
});
