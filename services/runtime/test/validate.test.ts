import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validateJobSpec } from "../src/kernel/validate.js";
import { agent, createWorkspace, jobSpec } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

describe("validateJobSpec", () => {
  it("accepts a well-formed job", () => {
    expect(() => validateJobSpec(jobSpec(workspace, agent(["read", "outputs_write"])))).not.toThrow();
  });

  it("rejects tools the kernel does not provide", () => {
    expect(() => validateJobSpec(jobSpec(workspace, agent(["bash", "read"])))).toThrow(/unknown tool "bash"/);
  });

  it("rejects missing workspace directories", () => {
    const spec = jobSpec(workspace, agent([]));
    spec.workspace.readOnly = [join(workspace.root, "missing")];
    expect(() => validateJobSpec(spec)).toThrow(/not a directory/);
  });

  it("rejects an empty read-only list", () => {
    const spec = jobSpec(workspace, agent([]));
    spec.workspace.readOnly = [];
    expect(() => validateJobSpec(spec)).toThrow(/at least one directory/);
  });

  it("rejects invalid and duplicate skill names", () => {
    const skills = [
      { name: "Bad Name", content: "x" },
      { name: "dup", content: "x" },
      { name: "dup", content: "y" },
    ];
    expect(() => validateJobSpec(jobSpec(workspace, agent([], { skills })))).toThrow(/skill name "Bad Name".*duplicate skill "dup"/);
  });

  it("rejects invalid deny patterns", () => {
    expect(() => validateJobSpec(jobSpec(workspace, agent([], { denyCommandPatterns: ["(unclosed"] })))).toThrow(/denyCommandPatterns/);
  });

  it("rejects empty instructions or task and invalid limits", () => {
    const spec = jobSpec(workspace, agent([], { instructions: " " }), { timeoutSec: 0, maxTurns: 0, maxCostUsd: -1 });
    spec.task = "";
    expect(() => validateJobSpec(spec)).toThrow(/instructions is empty.*task is empty.*timeoutSec.*maxTurns.*maxCostUsd/);
  });
});
