// The flow a command declares (metadata.flow, drawn in the portal) must be what its stage plan runs:
// the same scripts, agents and workflows, in the same order and groups. A plan that changes without
// its command, or the other way round, fails here.

import { type FlowNode, loadBuiltinCommands } from "@kintsugi/agents";
import { describe, expect, it } from "vitest";
import type { StageStep } from "../src/jobs/plan.js";
import { STAGES } from "../src/jobs/stages.js";

/** A comparable shape: kinds and names only (labels and gates are the command's own). */
type Shape = { kind: "script"; name: string; generated?: true; repair?: string } | { kind: "agent" | "workflow"; name: string } | { kind: "parallel"; steps: Shape[] } | { kind: "each"; step: Shape };

function ofPlan(steps: readonly StageStep[]): Shape[] {
  return steps.flatMap((step): Shape[] => {
    switch (step.kind) {
      case "script": {
        const name = (step.script.split("/").at(-1) ?? step.script).replace(/\.py$/, "");
        return [{ kind: "script", name, ...(step.fromInputs === true ? { generated: true as const } : {}), ...(step.repair === undefined ? {} : { repair: step.repair.agent }) }];
      }
      case "agent":
        return [{ kind: "agent", name: step.agent }];
      case "workflow":
        return [{ kind: "workflow", name: step.workflow }];
      case "parallel":
        return [{ kind: "parallel", steps: ofPlan(step.steps) }];
      case "forEach":
        return [{ kind: "each", step: ofPlan([step.step])[0]! }];
      case "repeat":
        return ofPlan(step.steps);
      case "gate":
        return [];
    }
  });
}

function ofFlow(nodes: readonly FlowNode[]): Shape[] {
  return nodes.flatMap((node): Shape[] => {
    switch (node.kind) {
      case "script":
        return [{ kind: "script", name: node.name, ...(node.generated === true ? { generated: true as const } : {}), ...(node.repair === undefined ? {} : { repair: node.repair }) }];
      case "agent":
      case "workflow":
        return [{ kind: node.kind, name: node.name }];
      case "parallel":
        return [{ kind: "parallel", steps: ofFlow(node.steps) }];
      case "each":
        return [{ kind: "each", step: ofFlow([node.step])[0]! }];
      case "gate":
        return [];
    }
  });
}

describe("command flows", () => {
  it("equal the stage plans that run them", async () => {
    const commands = await loadBuiltinCommands();
    const checked: string[] = [];
    for (const command of commands.filter((entry) => entry.audience === "runtime")) {
      const plan = STAGES[command.id];
      expect(plan, `stage ${command.id} has a plan`).toBeDefined();
      expect(command.flow, `command ${command.id} declares metadata.flow`).toBeDefined();
      expect(ofFlow(command.flow!), `flow of ${command.id}`).toEqual(ofPlan(plan!.steps));
      checked.push(command.id);
    }
    expect(checked).toEqual(["assess", "understand", "plan-understand", "design", "review"]);
  });
});
