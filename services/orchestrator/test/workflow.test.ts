// The workflow executor (ADR-0027): built-in workflow modules run as async functions with
// injected globals, within the agent cap and concurrency budget.

import { describe, expect, it } from "vitest";
import { loadWorkflow, runWorkflow, workflowBody, type AgentCallOptions } from "../src/jobs/workflow.js";

const inventory = { sloc: 1000, fileCount: 2, complexityTotal: 5, maxFileComplexity: 3, dominantLanguage: "C", metricsTool: "inventory.py" };

describe("workflow executor", () => {
  it("turns a module into a function body and refuses imports", () => {
    expect(workflowBody("export const meta = { name: 'x' }\nreturn meta.name")).toContain("const meta =");
    expect(() => workflowBody("import fs from 'node:fs'\nreturn 1")).toThrow(/may not import/);
    expect(() => workflowBody("export default 1")).toThrow(/may not import/);
  });

  it("loads built-in workflows by id only", async () => {
    await expect(loadWorkflow("../hooks/job_output")).rejects.toThrow(/Invalid workflow id/);
    expect(await loadWorkflow("portfolio-assess")).toContain("modernize-portfolio-assess");
  });

  it("runs portfolio-assess with structured agent results, bounded by the concurrency budget", async () => {
    let active = 0;
    let peak = 0;
    const calls: AgentCallOptions[] = [];
    const outcome = await runWorkflow({
      source: await loadWorkflow("portfolio-assess"),
      args: { apps: ["a", "b", "c"], inventories: { a: inventory, b: inventory, c: inventory } },
      budgets: { maxAgents: 10, concurrency: 2 },
      runAgent: async (_prompt, options) => {
        calls.push(options);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return { result: { depManifest: "none", depFreshness: "n/a", docCoveragePct: 10, riskNotes: [] }, tokens: 100 };
      },
      log: () => undefined,
    });
    expect(outcome.agents).toBe(3);
    expect(outcome.tokens).toBe(300);
    expect(peak).toBe(2);
    expect(calls.map((call) => call.label)).toEqual(["survey:a", "survey:b", "survey:c"]);
    expect((outcome.result as { rows: unknown[] }).rows).toHaveLength(3);
  });

  it("enforces the agent cap: calls past it fail and the workflow reports them", async () => {
    const outcome = await runWorkflow({
      source: await loadWorkflow("portfolio-assess"),
      args: { apps: ["a", "b"], inventories: { a: inventory, b: inventory } },
      budgets: { maxAgents: 1, concurrency: 1 },
      runAgent: async () => ({ result: { depManifest: "none", depFreshness: "n/a", docCoveragePct: 10, riskNotes: [] }, tokens: 1 }),
      log: () => undefined,
    });
    expect(outcome.agents).toBe(1);
    expect((outcome.result as { notSurveyed: string[] }).notSurveyed).toEqual(["b"]);
  });

  it("returns null for a failed agent job", async () => {
    const outcome = await runWorkflow({
      source: "const r = await agent('do it', { agentType: 'legacy-analyst' })\nreturn { r }",
      args: {},
      budgets: { maxAgents: 1, concurrency: 1 },
      runAgent: async () => ({ tokens: 0 }),
      log: () => undefined,
    });
    expect(outcome).toMatchObject({ result: { r: null }, failedAgents: 1 });
  });
});

it("checks the shared token budget again before starting a queued agent", async () => {
  let calls = 0;
  const outcome = await runWorkflow({
    source: 'return await parallel([() => agent("first"), () => agent("second"), () => agent("third")]);',
    args: {}, budgets: { concurrency: 1, maxTokens: 10 }, log: () => undefined,
    runAgent: async () => { calls += 1; return { result: "done", tokens: 10 }; },
  });
  expect(calls).toBe(1);
  expect(outcome.agents).toBe(1);
  expect(outcome.result).toEqual(["done", null, null]);
});

describe("harden-scan verification cap (T3-015)", () => {
  const finding = (index: number, severity: string) => ({
    cwe: "CWE-89",
    severity,
    confidence: "Medium",
    source: `legacy/src/F${index}.java:${index + 1}`,
    title: `Finding ${index}`,
    exploitScenario: "x",
    recommendedFix: "y",
  });
  const run = async (findings: ReturnType<typeof finding>[]) => {
    const labels: string[] = [];
    const outcome = await runWorkflow({
      source: await loadWorkflow("harden-scan"),
      args: { app: "billing", findings, classes: [] },
      budgets: { maxAgents: 500, concurrency: 8 },
      runAgent: async (_prompt, options) => {
        labels.push(options.label ?? "");
        return { result: { real: false, reason: "a false positive" }, tokens: 1 };
      },
      log: () => undefined,
    });
    return { labels, result: outcome.result as { refuted: { title: string }[]; unverified: { title: string; severity: string; unverifiedReason: string }[] } };
  };

  it("verifies at most 40 findings, the most severe first, and returns the rest unverified with the reason", async () => {
    const findings = [...Array.from({ length: 30 }, (_, i) => finding(i, "Low")), ...Array.from({ length: 15 }, (_, i) => finding(30 + i, "High"))];
    const { labels, result } = await run(findings);
    expect(labels.filter((label) => label.startsWith("refute:"))).toHaveLength(40);
    expect(result.refuted).toHaveLength(40);
    expect(result.unverified).toHaveLength(5);
    expect(result.unverified.every((f) => f.severity === "Low" && f.unverifiedReason.startsWith("over the verification cap"))).toBe(true);
    expect(result.refuted.filter((f) => f.title.startsWith("Finding 3") || f.title.startsWith("Finding 4")).length).toBeGreaterThanOrEqual(15);
  });

  it("verifies every finding below the cap", async () => {
    const { labels, result } = await run(Array.from({ length: 12 }, (_, i) => finding(i, "Medium")));
    expect(labels.filter((label) => label.startsWith("refute:"))).toHaveLength(12);
    expect(result.unverified).toEqual([]);
  });
});
