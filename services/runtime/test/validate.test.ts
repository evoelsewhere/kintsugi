import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_TIMER_SEC, validateJobSpec } from "../src/kernel/validate.js";
import { agent, createWorkspace, jobSpec } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

describe("validateJobSpec", () => {
  it("accepts a well-formed job", () => {
    expect(() => validateJobSpec(jobSpec(workspace, agent(["read", "write"])))).not.toThrow();
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
    expect(() => validateJobSpec(spec)).toThrow(/at least one entry/);
  });

  it("takes a file after the first read-only directory (the workspace guide), but not a missing one, and needs a root", () => {
    const guide = join(workspace.root, "WORKSPACE.md");
    writeFileSync(guide, "# guide\n");
    const spec = jobSpec(workspace, agent([]));
    spec.workspace.readOnly = [workspace.src, guide];
    expect(() => validateJobSpec(spec)).not.toThrow();
    spec.workspace.readOnly = [guide];
    expect(() => validateJobSpec(spec)).toThrow(/not a directory/);
    spec.workspace.readOnly = [workspace.src, join(workspace.root, "gone.md")];
    expect(() => validateJobSpec(spec)).toThrow(/does not exist/);
    spec.workspace.readOnly = [workspace.src];
    spec.workspace.root = join(workspace.root, "missing-root");
    expect(() => validateJobSpec(spec)).toThrow(/not a directory/);
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
    const spec = jobSpec(workspace, agent([], { instructions: " " }), { timeoutSec: -1, maxTurns: 0, maxCostUsd: -1 });
    spec.task = "";
    expect(() => validateJobSpec(spec)).toThrow(/instructions is empty.*task is empty.*timeoutSec.*maxTurns.*maxCostUsd/);
    // A timer Node cannot keep would fire at once and fail the job as timed out (T3-014); turns are whole.
    for (const limits of [{ timeoutSec: Infinity }, { timeoutSec: 3_000_000 }, { timeoutSec: 60, idleTimeoutSec: 3_000_000 }, { timeoutSec: 60, maxTurns: 1.5 }, { timeoutSec: 60, maxOutputBytes: 0.5 }]) {
      expect(() => validateJobSpec(jobSpec(workspace, agent([]), limits)), JSON.stringify(limits)).toThrow(/invalid job: limits\./);
    }
    expect(() => validateJobSpec(jobSpec(workspace, agent([]), { timeoutSec: MAX_TIMER_SEC, idleTimeoutSec: 0, maxTurns: 3 }))).not.toThrow();
  });
});
