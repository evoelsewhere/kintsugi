import { describe, expect, it } from "vitest";
import { effectiveModelBinding, THINKING_LEVEL_LABELS, THINKING_LEVELS, withProjectBindings } from "../src/index.js";

const bindings = [
  { agent: "legacy-analyst", provider: "default", model: "pro" },
  { agent: "legacy-analyst", projectId: "billing", provider: "fast", model: "flash" },
  { agent: "designer", projectId: "billing", provider: "fast", model: "flash" },
];

describe("effective model binding", () => {
  it("prefers the project binding over the installation default", () => {
    expect(effectiveModelBinding(bindings, "legacy-analyst", "billing")).toEqual({ binding: bindings[1], scope: "project" });
  });

  it("falls back to the installation default for other projects and without a project", () => {
    expect(effectiveModelBinding(bindings, "legacy-analyst", "payroll")).toEqual({ binding: bindings[0], scope: "installation" });
    expect(effectiveModelBinding(bindings, "legacy-analyst")).toEqual({ binding: bindings[0], scope: "installation" });
  });

  it("finds none when neither applies", () => {
    expect(effectiveModelBinding(bindings, "designer")).toBeUndefined();
    expect(effectiveModelBinding(bindings, "designer", "payroll")).toBeUndefined();
    expect(effectiveModelBinding(bindings, "unknown", "billing")).toBeUndefined();
  });
});

describe("project bindings for every agent", () => {
  it("replaces the project's bindings of those agents and keeps the rest", () => {
    const merged = withProjectBindings(bindings, "billing", ["legacy-analyst", "code-reviewer", "code-reviewer"], (agent) => ({ agent, projectId: "billing", provider: "p", model: "m" }));
    expect(merged).toEqual([
      bindings[0],
      bindings[2],
      { agent: "legacy-analyst", projectId: "billing", provider: "p", model: "m" },
      { agent: "code-reviewer", projectId: "billing", provider: "p", model: "m" },
    ]);
  });
});

describe("thinking level labels", () => {
  it("labels every level in title case", () => {
    for (const level of THINKING_LEVELS) expect(THINKING_LEVEL_LABELS[level]).toMatch(/^[A-Z]/);
  });
});
