// A command a member's harness carries out declares what the harness does as `step:` entries (drawn in the portal's Runs lane).

import { describe, expect, it } from "vitest";
import { loadBuiltinCommands, parseFlow } from "../src/index.js";

describe("harness steps in a flow", () => {
  it("parses a step with the tool it calls and the skill it follows, and refuses an empty or malformed one", () => {
    const problems: string[] = [];
    expect(parseFlow([{ step: "Read the unit", tool: "document_get" }, { gate: "you approve" }, { step: "Implement it", skill: "build-method" }, { step: "Plain" }], "flow", problems)).toEqual([
      { kind: "step", label: "Read the unit", tool: "document_get" },
      { kind: "gate", label: "you approve" },
      { kind: "step", label: "Implement it", skill: "build-method" },
      { kind: "step", label: "Plain" },
    ]);
    expect(problems).toEqual([]);
    for (const bad of [{ step: "" }, { step: 3 }, { step: "x", tool: "Not A Name" }, { step: "x", skill: 7 }]) {
      const found: string[] = [];
      expect(parseFlow([bad], "flow", found)).toBeUndefined();
      expect(found.length).toBeGreaterThan(0);
    }
  });

  it("tells the harness what to do, in order, for the command build, with the two decisions where a person decides", async () => {
    const build = (await loadBuiltinCommands()).find((command) => command.id === "build")!;
    expect(build.audience).toBe("member");
    const kinds = build.flow!.map((node) => node.kind);
    expect(kinds.filter((kind) => kind === "gate")).toHaveLength(2);
    expect(kinds.filter((kind) => kind === "step").length).toBeGreaterThanOrEqual(7);
    // The plan is approved before any code is written, and the merge request is recorded last.
    const labels = build.flow!.map((node) => (node.kind === "step" || node.kind === "gate" ? node.label : ""));
    expect(labels.findIndex((label) => label.startsWith("you approve the plan"))).toBeLessThan(labels.findIndex((label) => label.startsWith("Implement")));
    expect(build.flow!.at(-1)).toMatchObject({ kind: "step", tool: "activity_record" });
    expect(build.flow!.flatMap((node) => (node.kind === "step" && node.skill !== undefined ? [node.skill] : []))).toEqual(build.skills.filter((skill) => ["build-method", "unit-testing"].includes(skill)));
  });
});
