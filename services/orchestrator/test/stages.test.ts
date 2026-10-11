// Stage plans end to end in mock mode (ADR-0027): map, extract-rules and harden over fixture
// repositories with the mock agent backend, whose scripted outputs (mock-outputs.ts) give every
// later step valid inputs. Covers the executor's parts: script repair, gates defaulted, forEach
// fan-out, repeat-until, workflows inside a stage, intermediate outputs and prerequisites.

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { interpretersFromEnv } from "@kintsugi/runtime/launcher";
import type { JobSpec } from "@kintsugi/runtime-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";
import { leafCount } from "../src/jobs/plans/map.js";
import { JobRunner } from "../src/jobs/runner.js";
import { stageInfo } from "../src/jobs/stages.js";
import type { DocumentWriteRequest } from "../src/queues.js";
import { type AgentFiles, LocalCheckouts, MemoryJobStore, fixtureRepository, writingAgentRuntime } from "./support/jobs.js";

/** 45 modules: more than the 40 the "which nodes to describe" gate allows by default. */
const BIG_LEGACY: Record<string, string> = Object.fromEntries(
  Array.from({ length: 45 }, (_, index) => [`src/mod${String(index).padStart(2, "0")}.c`, `int f${index}(int x) {\n${"  if (x) { x++; }\n".repeat(index + 1)}  return x;\n}\n`]),
);
const SMALL_LEGACY = {
  "src/main.c": "int main(void) {\n  if (1) { return 0; }\n  return 1;\n}\n",
  "src/rates.c": "int rate(int amount) { if (amount > 100) { return amount * 2; } return amount; }\n",
  "package.json": '{ "name": "demo", "dependencies": { "left-pad": "1.0.0" } }\n',
};
const ASSESSED = {
  "kintsugi.yaml": "version: 1\nproject: { id: demo }\n",
  "assessment/demo/ASSESSMENT.md": "# Assessment\n\nTwo domains.\n",
  "standards/naming.md": "# Naming\n",
};

describe("stage plans (mock agent, fixture repositories)", () => {
  const repos: Record<string, ReturnType<typeof fixtureRepository>> = {};
  let dataDir: string;
  let storage: CheckoutStorage;

  beforeAll(async () => {
    repos["big"] = fixtureRepository(BIG_LEGACY);
    repos["small"] = fixtureRepository(SMALL_LEGACY);
    repos["docs"] = fixtureRepository(ASSESSED);
    repos["empty-docs"] = fixtureRepository({ "kintsugi.yaml": "version: 1\n" });
    dataDir = mkdtempSync(join(tmpdir(), "kintsugi-stages-data-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
  });
  afterAll(async () => {
    for (const repo of Object.values(repos)) await repo.remove();
    await rm(dataDir, { recursive: true, force: true });
  });

  async function runStage(stage: string, options: { legacy: string; docs?: string; files?: AgentFiles }) {
    const store = new MemoryJobStore();
    store.document = options.docs ?? "docs";
    const writes: DocumentWriteRequest[] = [];
    const agents = writingAgentRuntime(options.files ?? {});
    const runner = new JobRunner({
      store,
      storage,
      checkouts: new LocalCheckouts(Object.fromEntries(Object.entries(repos).map(([id, repo]) => [id, repo.bare]))),
      agents,
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      requestWrite: async (_repository, request) => {
        writes.push(request);
      },
      log: () => undefined,
    });
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "stage", name: stage, sourceRepositoryId: options.legacy, actor: "alice" });
    const run = await runner.run(id);
    const out = join(storage.job(id).out, "assessment", "demo");
    const summary = run?.outputSummary as { steps: Array<{ id: string; status: string; key?: string; round?: number }>; gates: Array<{ id: string; choice: string; defaulted: boolean }>; agents: number } | undefined;
    const logs = store.events.filter((event) => event.runId === id && event.kind === "log").map((event) => event.message);
    return { id, run, store, writes, agents, out, summary, logs, artifacts: (store.artifacts.get(id) ?? []).map((entry) => entry.path).sort() };
  }

  it("knows which stages are runnable and what they need first", () => {
    expect(stageInfo("demo")).toEqual([
      { id: "assess", requires: [] },
      { id: "map", requires: [{ stage: "assess", path: "assessment/demo/ASSESSMENT.md" }] },
      { id: "extract-rules", requires: [{ stage: "assess", path: "assessment/demo/ASSESSMENT.md" }] },
      { id: "harden", requires: [] },
    ]);
  });

  it("runs map: topology script (repaired once), flows, gate defaulted, 40 description jobs, merge, diagrams", async () => {
    let topologyJobs = 0;
    const { run, store, writes, agents, out, summary, logs, artifacts, id } = await runStage("map", {
      legacy: "big",
      files: {
        "legacy-analyst": (spec: JobSpec): Record<string, string> => {
          // The first script the topology job writes is broken; the repair job gets the error.
          if (spec.task.startsWith("Write the topology extraction script")) {
            topologyJobs += 1;
            return { "assessment/demo/extract_topology.py": "import sys\nraise SystemExit('cannot parse the estate')\n" };
          }
          return {};
        },
      },
    });
    expect(run?.failureReason).toBeUndefined();
    expect(run?.status).toBe("succeeded");
    expect(topologyJobs).toBe(1);
    const repair = agents.specs.find((spec) => spec.task.startsWith("The topology extraction script of application demo failed"));
    expect(repair?.task).toContain("cannot parse the estate");

    // Gate defaulted and recorded; 40 description jobs (not 45).
    expect(summary?.gates).toEqual([expect.objectContaining({ id: "describe", choice: "40 largest", defaulted: true })]);
    expect(logs.some((line) => line.startsWith("gate defaulted: describe"))).toBe(true);
    expect(summary?.steps.filter((step) => step.id === "describe-node" && step.status === "succeeded")).toHaveLength(40);
    expect(summary?.steps.map((step) => step.id).filter((step) => step !== "describe-node")).toEqual(["topology", "extract", "topology-fix", "extract", "flows", "packets", "merge", "diagrams"]);
    expect(summary?.steps.find((step) => step.id === "extract")?.status).toBe("failed");

    // The merged map carries the accepted descriptions; intermediate files stay out of the write.
    const topology = JSON.parse(readFileSync(join(out, "topology.json"), "utf8")) as unknown;
    expect(leafCount(topology)).toBe(45);
    expect(readFileSync(join(out, "topology.summary.txt"), "utf8")).toContain("Descriptions: 40 accepted");
    expect(artifacts).toEqual([
      "assessment/demo/call-graph.mmd",
      "assessment/demo/critical-path.mmd",
      "assessment/demo/data-lineage.mmd",
      "assessment/demo/extract_topology.py",
      "assessment/demo/topology.json",
      "assessment/demo/topology.summary.txt",
    ]);
    expect(existsSync(join(out, "node-packets"))).toBe(false);
    expect(writes[0]).toMatchObject({ outputOfJob: id, message: "Map demo: topology, flows and diagrams" });
    expect(store.children(id).filter((child) => child.status === "failed").map((child) => child.name)).toEqual(["extract_topology.py"]);
  }, 180_000);

  it("runs extract-rules in lens mode on a tiny estate: shards, workflow, rules_result.json, render", async () => {
    const { run, out, summary, artifacts, store, id } = await runStage("extract-rules", { legacy: "small" });
    expect(run?.failureReason).toBeUndefined();
    expect(run?.status).toBe("succeeded");
    expect(summary?.gates).toEqual([]);
    expect(summary?.steps.map((step) => [step.id, step.status])).toEqual([
      ["shards", "succeeded"],
      ["confirm", "skipped"],
      ["mine", "succeeded"],
      ["render", "succeeded"],
    ]);
    const result = JSON.parse(readFileSync(join(out, "rules_result.json"), "utf8")) as { mode: string; confirmedRules: Array<{ source: string }> };
    expect(result.mode).toBe("lenses");
    expect(result.confirmedRules[0]?.source).toMatch(/^src\/main\.c:1-1$/);
    expect(readFileSync(join(out, "BUSINESS_RULES.md"), "utf8")).toMatch(/^### RULE-001: /m);
    expect(artifacts).toEqual([
      "assessment/demo/BUSINESS_RULES.md",
      "assessment/demo/DATA_OBJECTS.md",
      "assessment/demo/extract-rules.modules.json",
      "assessment/demo/rules_result.json",
    ]);
    // The workflow's agent jobs are children of the workflow step; they count against the stage budget.
    const workflow = store.children(id).find((child) => child.kind === "workflow")!;
    expect(store.children(workflow.id).length).toBe(summary!.agents);
    expect(workflow.inputs["budget"]).toMatchObject({ maxAgents: expect.any(Number) });
  }, 180_000);

  it("runs harden: scan workflow, triage with a restricted inventory, one clean review round", async () => {
    const { run, out, summary, artifacts, store, id } = await runStage("harden", {
      legacy: "small",
      files: {
        "security-auditor": (spec: JobSpec): Record<string, string> =>
          spec.task.startsWith("Triage the security scan") ? { "restricted/SECRETS.local.md": "| hu** | src/main.c:2 | password |\n" } : {},
      },
    });
    expect(run?.failureReason).toBeUndefined();
    expect(run?.status).toBe("succeeded");
    expect(summary?.steps.filter((step) => step.id !== "scan").map((step) => [step.id, step.status, step.round ?? null])).toEqual([
      ["triage", "succeeded", null],
      ["review", "succeeded", 1],
      ["revise", "skipped", 1],
    ]);
    expect(artifacts).toEqual(["assessment/demo/SECURITY_FINDINGS.md", "assessment/demo/security_remediation.patch"]);
    expect(existsSync(join(out, "harden_scan.json"))).toBe(false);
    expect(existsSync(join(out, "patch_review.json"))).toBe(false);
    const triage = store.children(id).find((child) => child.inputs["label"] === "triage")!;
    expect(store.restricted.get(triage.id)?.get("SECRETS.local.md")).toContain("hu**");
  }, 180_000);

  it("revises the patch while the review is not clean, at most three rounds", async () => {
    const { run, summary } = await runStage("harden", {
      legacy: "small",
      files: {
        "security-auditor": (spec: JobSpec): Record<string, string> =>
          spec.task.startsWith("Review the security remediation patch")
            ? { "result.json": JSON.stringify({ clean: false, hunks: [{ finding: "SEC-001", verdict: "PARTIAL", reason: "misses one call site" }] }) }
            : {},
      },
    });
    expect(run?.status).toBe("succeeded");
    expect(summary?.steps.filter((step) => step.id === "review" || step.id === "revise").map((step) => `${step.id}:${step.round}:${step.status}`)).toEqual([
      "review:1:succeeded",
      "revise:1:succeeded",
      "review:2:succeeded",
      "revise:2:succeeded",
      "review:3:succeeded",
      "revise:3:succeeded",
    ]);
  }, 180_000);

  it("fails a stage whose prerequisite is not on the document repo's default branch, before any step", async () => {
    const { run, store, id, writes } = await runStage("map", { legacy: "small", docs: "empty-docs" });
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toBe(
      "assessment/demo/ASSESSMENT.md is not on the default branch of the document repository: run the assess stage first and merge its pull request, then run map again",
    );
    expect(store.children(id)).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it("fails an agent step that did not write what the plan expects (no mock outputs)", async () => {
    const store = new MemoryJobStore();
    const runner = new JobRunner({
      store,
      storage,
      checkouts: new LocalCheckouts({ small: repos["small"]!.bare, docs: repos["docs"]!.bare }),
      agents: writingAgentRuntime({}),
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      mockOutputs: false,
      requestWrite: async () => undefined,
      log: () => undefined,
    });
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "stage", name: "map", sourceRepositoryId: "small" });
    const run = await runner.run(id);
    expect(run?.failureReason).toBe("Step topology failed: Agent legacy-analyst did not write assessment/demo/extract_topology.py");
  });
});
