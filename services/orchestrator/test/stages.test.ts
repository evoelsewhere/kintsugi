// Stage plans end to end in mock mode (ADR-0027): map, extract-rules and harden over fixture
// repositories with the mock agent backend, whose scripted outputs (mock-outputs.ts) give every
// later step valid inputs. Covers the executor's parts: script repair, gates defaulted, forEach
// fan-out, repeat-until, workflows inside a stage, intermediate outputs and prerequisites.

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { PHASES } from "@kintsugi/domain";
import { CheckoutStorage } from "@kintsugi/git";
import { interpretersFromEnv } from "@kintsugi/runtime/launcher";
import type { JobSpec } from "@kintsugi/runtime-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";
import type { StageContext } from "../src/jobs/plan.js";
import { leafCount } from "../src/jobs/plans/map.js";
import { unitsToSpecify } from "../src/jobs/plans/understand.js";
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
/** The map of SMALL_LEGACY as the map stage would have merged it: two domains, one data store. */
const SMALL_TOPOLOGY = {
  system: "demo",
  root: {
    id: "sys",
    name: "demo",
    kind: "system",
    children: [
      { id: "dom:billing", name: "Billing", kind: "domain", children: [{ id: "MAIN", name: "main", kind: "module", file: "src/main.c", loc: 200 }] },
      { id: "dom:rates", name: "Rates", kind: "domain", children: [{ id: "RATES", name: "rates", kind: "module", file: "src/rates.c", loc: 300 }] },
      { id: "dom:data", name: "Data stores", kind: "domain", children: [{ id: "ds:RATES", name: "RATES", kind: "datastore" }] },
    ],
  },
  edges: [
    { source: "MAIN", target: "RATES", kind: "call" },
    { source: "RATES", target: "ds:RATES", kind: "read" },
  ],
  entryPoints: ["MAIN"],
  deadEnds: [],
  observations: [],
  flows: [],
};
/** assess, map and extract-rules merged (harden has not run); one unit already has a work item a person moved on. */
const MAPPED = {
  "kintsugi.yaml": "schemaVersion: 1\nunitKinds: [module, screen]\n",
  "assessment/demo/ASSESSMENT.md": "# Assessment\n\nTwo domains.\n",
  "assessment/demo/topology.json": JSON.stringify(SMALL_TOPOLOGY),
  "assessment/demo/BUSINESS_RULES.md": "# Business rules\n\n### RULE-001: Double large amounts\n**Source:** `src/rates.c:1`\n",
  "units/demo/billing/main.md": "---\nid: demo/billing/main\nstatus: in-progress\n---\n",
};
/** assess ran before: its catalog holds the source folder under another id, and an item whose file is gone. */
const CATALOGED = {
  "kintsugi.yaml": "schemaVersion: 1\nunitKinds: [module, screen]\n",
  "assessment/demo/catalog.json": JSON.stringify({
    schemaVersion: 1,
    app: "demo",
    modules: [{ id: "core", name: "Core", summary: "" }],
    items: [
      { id: "core/main-program", module: "core", kind: "module", name: "Main program", files: ["src/main.c", "src/rates.c"], status: "active" },
      { id: "core/gone", module: "core", kind: "module", name: "Gone", files: ["src/gone.c"], status: "active" },
    ],
    unassigned: [],
    ambiguities: [],
  }),
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
    repos["mapped-docs"] = fixtureRepository(MAPPED);
    repos["cataloged-docs"] = fixtureRepository(CATALOGED);
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
    const summary = run?.outputSummary as
      | { steps: Array<{ id: string; status: string; key?: string; round?: number }>; gates: Array<{ id: string; choice: string; defaulted: boolean }>; agents: number; missingInputs?: unknown }
      | undefined;
    const logs = store.events.filter((event) => event.runId === id && event.kind === "log").map((event) => event.message);
    return { id, run, store, writes, agents, out, summary, logs, artifacts: (store.artifacts.get(id) ?? []).map((entry) => entry.path).sort() };
  }

  it("knows which stages are runnable and what they need first", () => {
    expect(stageInfo("demo")).toEqual([
      { id: "assess", requires: [] },
      { id: "map", requires: [{ stage: "assess", path: "assessment/demo/ASSESSMENT.md" }] },
      { id: "extract-rules", requires: [{ stage: "assess", path: "assessment/demo/ASSESSMENT.md" }] },
      { id: "harden", requires: [] },
      {
        id: "understand",
        requires: [
          { stage: "assess", path: "assessment/demo/ASSESSMENT.md" },
          { stage: "map", path: "assessment/demo/topology.json" },
        ],
      },
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

  it("runs harden: scan workflow, carry-over of the assessment, triage with a restricted inventory, one clean review round", async () => {
    const { run, out, summary, artifacts, store, id, agents } = await runStage("harden", {
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

    // The assessment is on the default branch: the finders get it as a lead (at their own {in}), a
    // carry-over job settles its highlights, and the map's absence is recorded.
    expect(summary?.missingInputs).toEqual([{ path: "assessment/demo/topology.json", stage: "map" }]);
    const workflow = store.children(id).find((child) => child.kind === "workflow")!;
    expect(workflow.inputs["args"]).toEqual({ app: "demo", assessment: "assessment/demo/ASSESSMENT.md" });
    const jobs = store.children(workflow.id);
    expect(jobs.map((job) => job.inputs["label"]).filter((label) => typeof label === "string" && !label.startsWith("find:"))).toEqual(
      expect.arrayContaining(["carry-over", expect.stringMatching(/^refute:/)]),
    );
    const finder = jobs.find((job) => job.inputs["label"] === "find:injection")!;
    const finderSpec = agents.specs.find((spec) => spec.metadata?.jobRunId === finder.id)!;
    expect(finderSpec.task).toContain(`${finder.id}${sep}in/assessment/demo/ASSESSMENT.md (read-only)`);
    expect(finderSpec.task).not.toContain("{in}");
    expect(finderSpec.task).toContain("your manual review IS the scan");
    const result = (workflow.outputSummary as { result: Record<string, unknown> }).result;
    expect(result["coverage"]).toMatchObject({ filesReviewed: ["mock reviewed"], byClass: { injection: 1, deps: 1 } });
    expect(result["toolsNotRun"]).toEqual([{ tool: "mock tool", reason: "mock reason" }]);
    expect(result["carryOver"]).toMatchObject({
      assessment: "assessment/demo/ASSESSMENT.md",
      checked: true,
      highlights: [{ ref: "mock ref", status: "confirmed", finding: { cwe: "CWE-20", confidence: "High" } }],
    });
  }, 180_000);

  it("runs harden without an assessment: no carry-over job, both leads recorded as missing", async () => {
    const { run, summary, store, id } = await runStage("harden", { legacy: "small", docs: "empty-docs" });
    expect(run?.status).toBe("succeeded");
    expect(summary?.missingInputs).toEqual([
      { path: "assessment/demo/ASSESSMENT.md", stage: "assess" },
      { path: "assessment/demo/topology.json", stage: "map" },
    ]);
    const workflow = store.children(id).find((child) => child.kind === "workflow")!;
    expect(workflow.inputs["args"]).toEqual({ app: "demo" });
    expect(store.children(workflow.id).some((job) => job.inputs["label"] === "carry-over")).toBe(false);
    expect((workflow.outputSummary as { result: Record<string, unknown> }).result["carryOver"]).toBeNull();
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

  it("re-assesses: topology script under tools/, the catalog keeps the ids of the previous one and retires what is gone", async () => {
    const { run, summary, artifacts, out, agents } = await runStage("assess", { legacy: "small", docs: "cataloged-docs" });
    expect(run?.failureReason).toBeUndefined();
    const ids = summary?.steps.map((step) => step.id) ?? [];
    // The analysis jobs run in parallel: they finish in any order.
    expect(ids.slice(1, 4).sort()).toEqual(["debt", "security", "structure"]);
    expect([ids[0], ...ids.slice(4)]).toEqual([
      "inventory",
      "topology",
      "extract",
      "catalog",
      "catalog-curate",
      "catalog-edits",
      "catalog-reconcile",
      "synthesis",
    ]);
    expect(artifacts).toEqual(
      expect.arrayContaining(["assessment/demo/catalog.json", "assessment/demo/topology.json", "assessment/demo/tools/extract_topology.py"]),
    );
    expect(artifacts.some((path) => path.includes("catalog-draft"))).toBe(false);
    const catalog = JSON.parse(readFileSync(join(out, "catalog.json"), "utf8")) as {
      items: Array<{ id: string; module: string; files: string[]; status: string; aliases: string[] }>;
      unassigned: string[];
      reconciled: Record<string, unknown>;
    };
    expect(catalog.items.map((item) => [item.id, item.module, item.status])).toEqual([
      ["core/gone", "core", "retired"],
      ["core/main-program", "core", "active"],
    ]);
    expect(catalog.items[1]).toMatchObject({ files: ["src/main.c", "src/rates.c"], aliases: ["Main program"] });
    expect(catalog.unassigned).toEqual(["package.json"]);
    expect(catalog.reconciled).toEqual({ from: "catalog", kept: 1, new: 0, retired: 1, renamed: 1 });
    // The curation job saw the proposal and got the edit schema.
    const curate = agents.specs.find((spec) => spec.task.startsWith("Curate the item catalog"));
    expect(curate?.task).toContain("Return your result as JSON matching this schema");
  }, 120_000);

  it("runs understand: units from the map, gate defaulted, one spec job per unit, traceability, synthesis, work items in one PR", async () => {
    const { run, writes, agents, summary, logs, artifacts, id, store, out } = await runStage("understand", { legacy: "small", docs: "mapped-docs" });
    expect(run?.failureReason).toBeUndefined();
    expect(run?.status).toBe("succeeded");

    // Units from topology.json; the gate took its default; harden's findings were missing and are recorded.
    expect(summary?.gates).toEqual([expect.objectContaining({ id: "specify", choice: "all within the budget", defaulted: true })]);
    expect(logs.some((line) => line.startsWith("gate defaulted: specify — 2 units proposed from the map"))).toBe(true);
    expect(summary?.missingInputs).toEqual([{ path: "assessment/demo/SECURITY_FINDINGS.md", stage: "harden" }]);
    expect(logs).toContain("optional input missing: assessment/demo/SECURITY_FINDINGS.md (run harden and merge its pull request to use it)");
    // The spec jobs run concurrently: they finish in any order.
    const steps = summary?.steps.map((step) => [step.id, step.status, step.key ?? null]) ?? [];
    expect(steps.filter((step) => step[0] !== "specify-unit")).toEqual([
      ["units", "succeeded", null],
      ["traceability", "succeeded", null],
      ["synthesis", "succeeded", null],
      ["work-items", "succeeded", null],
    ]);
    expect(steps.slice(1, 3).map((step) => `${step[1]}:${step[2]}`).sort()).toEqual(["succeeded:billing/main", "succeeded:rates/rates"]);
    expect(summary?.agents).toBe(3);

    // Each spec job got its brief and the structured-result schema.
    const specs = agents.specs.filter((spec) => spec.task.startsWith("Write the AS-IS specification"));
    expect(specs.map((spec) => /\/knowledge\/as-is\/demo\/briefs\/([a-z/]+)\.json/.exec(spec.task)?.[1]).sort()).toEqual(["billing/main", "rates/rates"]);
    const main = specs.find((spec) => spec.task.includes("/briefs/billing/main.json"));
    expect(main?.task).toContain("knowledge/as-is/demo/billing/main.md with outputs_write");
    expect(main?.task).toContain('"rulesApplied"');

    // Published: specifications, the overview, the matrix and the new work items; units.json, briefs and fragments stay out.
    expect(artifacts).toEqual([
      "knowledge/as-is/demo/README.md",
      "knowledge/as-is/demo/architecture.md",
      "knowledge/as-is/demo/billing/main.md",
      "knowledge/as-is/demo/data-model.md",
      "knowledge/as-is/demo/integrations.md",
      "knowledge/as-is/demo/rates/rates.md",
      "knowledge/as-is/demo/traceability.json",
      "knowledge/as-is/demo/traceability.md",
      "units/demo/rates/rates.md",
    ]);
    const root = join(out, "..", "..");
    const asIs = join(root, "knowledge", "as-is", "demo");
    expect(existsSync(join(asIs, "units.json"))).toBe(false);
    expect(existsSync(join(asIs, "trace"))).toBe(false);
    const matrix = JSON.parse(readFileSync(join(asIs, "traceability.json"), "utf8")) as {
      units: Array<{ id: string; spec: string | null; dependsOn: string[]; rules: string[]; dataStores: Array<{ id: string }> }>;
      rules: Record<string, string[]>;
      inputs: { businessRules: boolean; securityFindings: boolean };
    };
    expect(matrix.units.map((unit) => [unit.id, unit.spec, unit.dependsOn])).toEqual([
      ["demo/billing/main", "knowledge/as-is/demo/billing/main.md", ["demo/rates/rates"]],
      ["demo/rates/rates", "knowledge/as-is/demo/rates/rates.md", []],
    ]);
    expect(matrix.rules).toEqual({ "RULE-001": ["demo/rates/rates"] });
    expect(matrix.units[1]?.dataStores).toEqual([{ id: "ds:RATES", access: ["read"] }]);
    expect(matrix.inputs).toEqual({ businessRules: true, securityFindings: false });
    expect(readFileSync(join(asIs, "traceability.md"), "utf8")).toMatch(/^Legacy repository small at [0-9a-f]{40}\n/);
    expect(readFileSync(join(asIs, "billing", "main.md"), "utf8")).toContain("## Business rules applied");

    // The work item follows the unit-file format; the one a person already has is left alone.
    const item = readFileSync(join(root, "units", "demo", "rates", "rates.md"), "utf8");
    const front = Object.fromEntries(
      /^---\n([\s\S]*?)\n---\n/
        .exec(item)![1]!
        .split("\n")
        .filter((line) => /^[a-zA-Z]+: \S/.test(line))
        .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)]),
    );
    expect(front).toMatchObject({ id: '"demo/rates/rates"', application: '"demo"', module: '"rates"', kind: '"module"', phase: "discover-assess", stage: "understand", status: "pending", complexity: "low", dependsOn: "[]" });
    expect(PHASES).toContain(front["phase"]);
    expect(item).toContain('  - {repo: "small", paths: ["src/rates.c"]}');
    expect(item).toContain('  asIs: "knowledge/as-is/demo/rates/rates.md"\n  businessRules: ["RULE-001"]');
    expect(existsSync(join(root, "units", "demo", "billing", "main.md"))).toBe(false);

    // One write, all of it through the pull request.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ outputOfJob: id, message: "Understand demo: AS-IS specifications, traceability and work items", reviewAll: true });
    expect(store.children(id).filter((child) => child.status === "failed")).toHaveLength(0);
  }, 180_000);

  it("chooses the units to specify: entry points first, then the largest, within the budget minus the synthesis job", async () => {
    const units = {
      units: [
        { key: "a/small", brief: "briefs/a/small.json", loc: 10 },
        { key: "a/big", brief: "briefs/a/big.json", loc: 900 },
        { key: "b/entry", brief: "briefs/b/entry.json", loc: 5, entryPoint: true },
        { key: "../escape", brief: "briefs/../escape.json", loc: 9999 },
      ],
    };
    const context = (gate: string | undefined, left: number): StageContext => ({
      app: "demo",
      repo: "small",
      commit: "c",
      scope: undefined,
      round: 0,
      readText: async () => undefined,
      readJson: async (path) => (path === "knowledge/as-is/demo/units.json" ? units : undefined),
      stdout: () => undefined,
      gate: () => gate,
      agentsLeft: () => left,
    });
    expect(await unitsToSpecify(context("all within the budget", 10))).toEqual(["b/entry", "a/big", "a/small"]);
    expect(await unitsToSpecify(context("all within the budget", 3))).toEqual(["b/entry", "a/big"]);
    expect(await unitsToSpecify(context("entry points only", 10))).toEqual(["b/entry"]);
    expect(await unitsToSpecify(context(undefined, 1))).toEqual([]);
  });

  it("fails understand before any step when the map is not merged yet", async () => {
    const { run, store, id, writes } = await runStage("understand", { legacy: "small" });
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toBe(
      "assessment/demo/topology.json is not on the default branch of the document repository: run the map stage first and merge its pull request, then run understand again",
    );
    expect(store.children(id)).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

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
