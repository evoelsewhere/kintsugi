// What keeps a job inside its window and its prompt cacheable (ADR-0048).

import { describe, expect, it } from "vitest";
import { compactionBudget, stableSessionId } from "../src/kernel/context.js";
import { boundOutput } from "../src/kernel/output.js";
import { normalizeTools } from "../src/kernel/tool-names.js";
import { agent, createWorkspace, jobSpec } from "./helpers.js";

describe("compactionBudget", () => {
  it("scales the reserve and the kept tail with the window, within bounds", () => {
    expect(compactionBudget(200_000)).toEqual({ reserveTokens: 30_000, keepRecentTokens: 20_000 });
    expect(compactionBudget(1_000_000)).toEqual({ reserveTokens: 65_536, keepRecentTokens: 40_000 });
    expect(compactionBudget(128_000)).toEqual({ reserveTokens: 19_200, keepRecentTokens: 20_000 });
  });

  it("never reserves more than half a small window", () => {
    const small = compactionBudget(8_000);
    expect(small.reserveTokens).toBe(4_000);
    expect(small.keepRecentTokens).toBe(2_000);
  });

  it("falls back to 128k for a window nobody declared", () => {
    expect(compactionBudget(0)).toEqual(compactionBudget(128_000));
    expect(compactionBudget(Number.NaN)).toEqual(compactionBudget(128_000));
  });
});

describe("stableSessionId", () => {
  const workspace = createWorkspace();
  const spec = (tools: string[], extra = {}) => jobSpec(workspace, agent(tools, { skills: [{ name: "style", content: "Be terse." }], ...extra }));

  it("is the same for every job of one agent, model and tool set, whatever the order of the tools", () => {
    expect(stableSessionId(spec(["read", "grep"]))).toBe(stableSessionId(spec(["grep", "read", "read"])));
    expect(stableSessionId(spec(["read"]))).toMatch(/^test-agent-[0-9a-f]{16}$/);
  });

  it("changes with anything that changes the prompt prefix", () => {
    const base = stableSessionId(spec(["read"]));
    expect(stableSessionId(spec(["read", "ls"]))).not.toBe(base);
    expect(stableSessionId(spec(["read"], { instructions: "Another." }))).not.toBe(base);
    expect(stableSessionId(spec(["read"], { version: "2.0.0" }))).not.toBe(base);
    expect(stableSessionId(spec(["read"], { skills: [{ name: "style", content: "Be loud." }] }))).not.toBe(base);
    expect(stableSessionId({ ...spec(["read"]), model: { provider: "faux", id: "m2" } })).not.toBe(base);
  });
});

describe("normalizeTools", () => {
  it("puts the tools in the kernel's order and drops duplicates", () => {
    expect(normalizeTools(["git", "read", "ls", "read", "edit"])).toEqual(["read", "ls", "edit", "git"]);
    expect(normalizeTools([])).toEqual([]);
  });
});

describe("boundOutput", () => {
  const lines = (count: number): string => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

  it("leaves a small output alone", () => {
    expect(boundOutput("a\nb", "head")).toEqual({ text: "a\nb" });
  });

  it("keeps the start of a long listing and the end of a long log, and says what was cut", () => {
    const head = boundOutput(lines(5000), "head");
    expect(head.text.startsWith("line 1\n")).toBe(true);
    expect(head.text).not.toContain("line 5000");
    expect(head.notice).toMatch(/first .* lines/);
    const tail = boundOutput(lines(5000), "tail");
    expect(tail.text.endsWith("line 5000")).toBe(true);
    expect(tail.text).not.toContain("line 1\n");
    expect(tail.notice).toMatch(/last .* lines/);
  });

  it("cuts by size when a few lines are huge", () => {
    const bounded = boundOutput("x".repeat(200_000), "tail");
    expect(bounded.text.length).toBeLessThan(60_000);
    expect(bounded.notice).toBeDefined();
  });
});
