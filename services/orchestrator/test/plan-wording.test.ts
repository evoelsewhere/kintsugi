// Task wording that ends searches (QA R-2): an optional input is stated as there or not, a task whose result is its
// files ends with an explicit stop, and the preamble names the step's exact folders.

import { applicationInputPath, assessmentCatalogPath, standardsDir } from "@kintsugi/domain";
import { describe, expect, it } from "vitest";
import type { AgentStep, LeafStep, StageContext, StageStep } from "../src/jobs/plan.js";
import { ASSESS } from "../src/jobs/plans/assess.js";
import { STOP, WORKSPACE } from "../src/jobs/plans/common.js";

const context = (files: Record<string, string>, folders?: readonly string[]): StageContext => ({
  app: "demo",
  sources: "legacy@abc",
  scope: undefined,
  round: 0,
  readText: async (path) => files[path.replaceAll("{app}", "demo")],
  readJson: async () => undefined,
  stdout: () => undefined,
  gate: () => undefined,
  agentsLeft: () => Infinity,
  ...(folders === undefined ? {} : { exists: async (path: string) => folders.includes(path.replaceAll("{app}", "demo")) || files[path.replaceAll("{app}", "demo")] !== undefined }),
});

const leaves = (steps: readonly StageStep[]): LeafStep[] => steps.flatMap((step) => (step.kind === "parallel" ? [...step.steps] : step.kind === "script" || step.kind === "agent" || step.kind === "workflow" ? [step] : []));
const agentStep = (id: string): AgentStep => {
  const step = leaves(ASSESS.steps).find((leaf) => leaf.id === id);
  if (step?.kind !== "agent") throw new Error(`no agent step ${id}`);
  return step;
};
const taskOf = async (id: string, ctx: StageContext): Promise<string> => {
  const task = agentStep(id).task;
  return typeof task === "function" ? task(ctx) : task;
};

describe("assess task wording", () => {
  it("tells the curation job that this is the first catalog, or where the previous one is", async () => {
    const first = await taskOf("catalog-curate", context({}, []));
    expect(first).toContain("This is the first catalog of the application");
    expect(first).not.toMatch(/if present/i);
    const again = await taskOf("catalog-curate", context({ [assessmentCatalogPath("demo")]: "# Catalog\n" }, []));
    expect(again).toContain("is the previous catalog");
    expect(again).not.toContain("This is the first catalog");
  });

  it("settles the previous catalog with one read when the stage cannot tell, since a later step writes the same path", async () => {
    const task = await taskOf("catalog-curate", context({ [assessmentCatalogPath("demo")]: "# Catalog\n" }));
    expect(task).toContain(`Read {in}/${assessmentCatalogPath("{app}")} once`);
    expect(task).toContain("do not look for it anywhere else");
    expect(await taskOf("catalog-curate", context({}))).toBe(task);
  });

  it("states each attached input of the synthesis as there or not", async () => {
    const none = await taskOf("synthesis", context({}, []));
    expect(none).toContain("No INTENT.md");
    expect(none).toContain("No telemetry");
    expect(none).toContain("No project standards");
    expect(none).not.toMatch(/if present/i);
    const all = await taskOf("synthesis", context({ [applicationInputPath("demo", "INTENT.md")]: "# Intent\n" }, [`${applicationInputPath("demo", "telemetry")}/`, `${standardsDir()}/`]));
    expect(all).not.toContain("No INTENT.md");
    expect(all).not.toContain("No telemetry");
    expect(all).not.toContain("No project standards");
  });

  it("ends the tasks that write files with a stop, and the topology task with its script", async () => {
    for (const id of ["structure", "debt", "security", "synthesis"]) expect(await taskOf(id, context({}, []))).toContain(STOP);
    const topology = await taskOf("topology", context({}, []));
    expect(topology).toMatch(/is written, reply DONE and stop/);
    expect(topology).toContain("Nobody attached a dependency export");
    expect(topology).not.toMatch(/if present/i);
  });

  it("names the step's exact folders and says the root has no src/ or in/", () => {
    for (const placeholder of ["{src}/", "{in}/", "{out}/"]) expect(WORKSPACE).toContain(placeholder);
    expect(WORKSPACE).toContain("There is no src/, in/ or out/ folder at the workspace root");
  });
});
