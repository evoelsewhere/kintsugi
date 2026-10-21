// Stage plans end to end in mock mode (ADR-0027): assess, understand, plan-understand and the rebuild over fixture
// repositories with the mock agent backend, whose scripted outputs (mock-outputs.ts) give every
// later step valid inputs. Covers the executor's parts: script repair, gates defaulted, forEach
// fan-out, repeat-until, workflows inside a stage, intermediate outputs and prerequisites. The document
// repository holds Markdown only (ADR-0042): what the steps pass to each other is scratch and never published.

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { documentOf, parseItemCatalog } from "@kintsugi/agents/reader";
import { CheckoutStorage } from "@kintsugi/git";
import { interpretersFromEnv } from "@kintsugi/runtime/launcher";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";
import { understandMessage } from "../src/jobs/plans/understand.js";
import { REBUILD } from "../src/jobs/plans/rebuild.js";
import { appsTouched } from "../src/aggregates.js";
import { DEFAULT_AUTO_COMMIT_PATHS, isAutoCommitPath } from "@kintsugi/domain";
import { JobRunner } from "../src/jobs/runner.js";
import { stageInfo } from "../src/jobs/stages.js";
import type { DocumentWriteRequest } from "../src/queues.js";
import { catalogDocuments, understoodUnit } from "./support/documents.js";
import { type AgentFiles, LocalCheckouts, MemoryJobStore, fixtureRepository, writingAgentRuntime } from "./support/jobs.js";

const SMALL_LEGACY = {
  "src/main.c": "int main(void) {\n  if (1) { return 0; }\n  return 1;\n}\n",
  "src/rates.c": "int rate(int amount) { if (amount > 100) { return amount * 2; } return amount; }\n",
  "package.json": '{ "name": "demo", "dependencies": { "left-pad": "1.0.0" } }\n',
};
const MANIFEST = { "kintsugi.yaml": "schemaVersion: 1\nunitKinds: [module, screen]\n" };
/** assess ran before: its catalog holds the source folder under another id, and an item whose file is gone. */
const CATALOGED = {
  ...MANIFEST,
  ...catalogDocuments(
    "demo",
    [{ id: "core", name: "Core" }],
    [
      { id: "core/main-program", name: "Main program", files: ["src/main.c", "src/rates.c"] },
      { id: "core/gone", name: "Gone", files: ["src/gone.c"] },
    ],
  ),
};
/** assess merged its catalog (the links between items are in its cards); one item already has a work item a person moved on. */
const CATALOGED_SMALL = {
  ...MANIFEST,
  "applications/demo/assessment/ASSESSMENT.md": "# Assessment\n\nTwo domains.\n",
  ...catalogDocuments(
    "demo",
    [
      { id: "billing", name: "Billing" },
      { id: "rates", name: "Rates" },
    ],
    [
      { id: "billing/main", files: ["src/main.c"], leaves: ["MAIN"], entryPoints: ["MAIN"], dependsOn: ["rates/rates"] },
      { id: "rates/rates", files: ["src/rates.c"], leaves: ["RATES"], dataStores: ["ds:RATES"] },
    ],
    ["package.json"],
  ),
  "applications/demo/units/billing/main/unit.md": "---\nid: demo/billing/main\nstatus: in-progress\n---\n",
};
const ASSESSED = {
  "kintsugi.yaml": "version: 1\nproject: { id: demo }\n",
  "applications/demo/assessment/ASSESSMENT.md": "# Assessment\n\nTwo domains.\n",
  "standards/naming.md": "# Naming\n",
};

describe("stage plans (mock agent, fixture repositories)", () => {
  const repos: Record<string, ReturnType<typeof fixtureRepository>> = {};
  let dataDir: string;
  let storage: CheckoutStorage;

  beforeAll(async () => {
    repos["small"] = fixtureRepository(SMALL_LEGACY);
    repos["docs"] = fixtureRepository(ASSESSED);
    repos["empty-docs"] = fixtureRepository({ "kintsugi.yaml": "version: 1\n" });
    repos["cataloged-docs"] = fixtureRepository(CATALOGED);
    repos["cataloged-small-docs"] = fixtureRepository(CATALOGED_SMALL);
    repos["understood-docs"] = fixtureRepository({
      ...CATALOGED_SMALL,
      ...understoodUnit("demo", "rates/rates", { digest: "sha256:rates", commit: "a".repeat(40), rule: { id: "RULE-rates.rates-1a2b3c4d", name: "Double large amounts", source: "src/rates.c:1" } }),
    });
    dataDir = mkdtempSync(join(tmpdir(), "kintsugi-stages-data-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
  });
  afterAll(async () => {
    for (const repo of Object.values(repos)) await repo.remove();
    await rm(dataDir, { recursive: true, force: true });
  });

  async function runStage(stage: string, options: { legacy: string; docs?: string; files?: AgentFiles; inputs?: Record<string, unknown> }) {
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
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "stage", name: stage, sourceRepositoryId: options.legacy, actor: "alice", ...(options.inputs === undefined ? {} : { inputs: options.inputs }) });
    const run = await runner.run(id);
    const root = storage.job(id).out;
    const out = join(root, "applications", "demo", "assessment");
    const summary = run?.outputSummary as
      | { steps: Array<{ id: string; status: string; key?: string; round?: number }>; gates: Array<{ id: string; choice: string; defaulted: boolean }>; agents: number; missingInputs?: unknown }
      | undefined;
    const logs = store.events.filter((event) => event.runId === id && event.kind === "log").map((event) => event.message);
    return { id, run, store, writes, agents, root, out, summary, logs, artifacts: (store.artifacts.get(id) ?? []).map((entry) => entry.path).sort() };
  }

  it("knows which stages are runnable and what they need first", () => {
    const catalog = "applications/demo/assessment/catalog/index.md";
    expect(stageInfo("demo")).toEqual([
      { id: "assess", requires: [] },
      { id: "understand", requires: [{ stage: "assess", path: catalog }] },
      { id: "plan-understand", requires: [{ stage: "assess", path: catalog }] },
      { id: "rebuild", requires: [{ stage: "assess", path: catalog }] },
    ]);
  });

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
      "topology-render",
      "catalog",
      "catalog-curate",
      "catalog-edits",
      "catalog-reconcile",
      "catalog-render",
      "synthesis",
      "architecture-style",
    ]);
    // The document repository gets Markdown: the summaries, the catalog and the extraction script. The per-file
    // inventory, the raw topology and the catalog drafts are scratch of the run and never published.
    expect(artifacts).toEqual(
      expect.arrayContaining([
        "applications/demo/assessment/inventory.md",
        "applications/demo/assessment/topology.md",
        "applications/demo/assessment/catalog/index.md",
        "applications/demo/assessment/catalog/core.md",
        "applications/demo/assessment/tools/extract_topology.py",
      ]),
    );
    expect(artifacts.filter((path) => path.endsWith(".json") || path.startsWith("scratch/") || path.includes("catalog-draft"))).toEqual([]);
    const catalog = parseItemCatalog(readFileSync(join(out, "catalog", "index.md"), "utf8"), { core: readFileSync(join(out, "catalog", "core.md"), "utf8") })!;
    expect(catalog.items.map((item) => [item.id, item.module, item.status])).toEqual([
      ["core/gone", "core", "retired"],
      ["core/main-program", "core", "active"],
    ]);
    expect(catalog.items[1]).toMatchObject({ files: ["src/main.c", "src/rates.c"], aliases: ["Main program"] });
    expect(catalog.unassigned).toEqual(["package.json"]);
    // The mock extraction found no edges, and the inventory summary names the source commit.
    expect(documentOf(readFileSync(join(out, "inventory.md"), "utf8")).data).toMatchObject({ app: "demo", fileCount: 3, sourceFileCount: 2 });
    expect(documentOf(readFileSync(join(out, "topology.md"), "utf8")).data).toMatchObject({ system: "demo", domains: 1 });
    // The curation job saw the proposal and got the edit schema.
    const curate = agents.specs.find((spec) => spec.task.startsWith("Curate the item catalog"));
    expect(curate?.task).toContain("Return your result as JSON matching this schema");
  }, 120_000);

  it("runs understand on a selection: per-item documents, rules and findings, one spec job per item, the understanding record and work items in one PR", async () => {
    const { run, writes, agents, summary, artifacts, id, store, root } = await runStage("understand", {
      legacy: "small",
      docs: "cataloged-small-docs",
      inputs: { scope: { items: ["billing/main", "rates/rates"], files: ["src/main.c", "src/rates.c"] } },
    });
    expect(run?.failureReason).toBeUndefined();
    expect(run?.status).toBe("succeeded");
    const steps = summary?.steps.map((step) => [step.id, step.status, step.key ?? null]) ?? [];
    expect(steps.filter((step) => step[0] !== "specify-item" && step[0] !== "rules" && step[0] !== "security")).toEqual([
      ["scope", "succeeded", null],
      ["split-rules", "succeeded", null],
      ["split-findings", "succeeded", null],
      ["finish", "succeeded", null],
    ]);
    expect(steps.filter((step) => step[0] === "specify-item").map((step) => step[2]).sort()).toEqual(["billing/main", "rates/rates"]);

    // Each spec job got its brief and its item's rule and finding documents.
    const specs = agents.specs.filter((spec) => spec.task.startsWith("Write the AS-IS specification of one catalog item"));
    const main = specs.find((spec) => spec.task.includes("/understand/briefs/billing/main.json"));
    expect(main?.task).toContain("applications/demo/units/billing/main/understanding/rules.md");
    expect(main?.task).toContain("applications/demo/units/billing/main/understanding/as-is.md with write");

    // Only per-unit Markdown is published; briefs, shards, traces and workflow results stay out.
    const files = ["as-is.md", "data-objects.md", "findings.md", "rules.md", "topology.md", "trace.md", "understanding.md"];
    expect(artifacts).toEqual([
      ...files.map((file) => `applications/demo/units/billing/main/understanding/${file}`),
      ...files.map((file) => `applications/demo/units/rates/rates/understanding/${file}`),
      "applications/demo/units/rates/rates/unit.md",
    ]);
    const unit = (path: string): string => readFileSync(join(root, "applications", "demo", "units", ...path.split("/")), "utf8");
    // The topology document of an item: its leaves, the items it depends on, the data stores it touches.
    const topology = unit("billing/main/understanding/topology.md");
    expect(documentOf(topology).data).toMatchObject({ item: "billing/main", leaves: 1, entryPoints: 1 });
    expect(topology).toContain("| rates/rates | call | 1 |");
    expect(unit("rates/rates/understanding/topology.md")).toContain("| ds:RATES | read |");
    const record = documentOf(unit("rates/rates/understanding/understanding.md")).data;
    expect(record).toMatchObject({ item: "rates/rates", status: "understood", digest: "sha256:rates", runId: id, specification: "applications/demo/units/rates/rates/understanding/as-is.md" });
    expect(record["commit"]).toMatch(/^[0-9a-f]{40}$/);
    // The work item a person already has is left alone.
    expect(existsSync(join(root, "applications", "demo", "units", "billing", "main", "unit.md"))).toBe(false);
    expect(unit("rates/rates/unit.md")).toContain('id: "demo/rates/rates"');

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ outputOfJob: id, message: "Understand demo: main, rates", reviewAll: true });
    expect(store.children(id).filter((child) => child.status === "failed")).toHaveLength(0);
  }, 180_000);

  const planningTask = (spec: { task: string }): boolean => spec.task.startsWith("Plan the order") || spec.task.startsWith("The plan for application");

  it("plans what to understand next: the graph, an agent's batches, a checked plan committed straight to the default branch", async () => {
    const draft = {
      strategy: "Rates first, the entry point after.",
      batches: [
        { title: "Rates", items: ["rates/rates", "nope/x"], rationale: "Called by main.", risk: "high" },
        { title: "Entry", items: ["billing/main"], rationale: "Needs rates.", risk: "medium" },
      ],
    };
    const { run, writes, agents, summary, artifacts, root } = await runStage("plan-understand", {
      legacy: "small",
      docs: "cataloged-small-docs",
      files: { "understand-planner": (spec): Record<string, string> => (planningTask(spec) ? { "result.json": JSON.stringify(draft) } : {}) },
    });
    expect(run?.failureReason).toBeUndefined();
    expect(run?.status).toBe("succeeded");
    expect(summary?.steps.map((step) => [step.id, step.status])).toEqual([
      ["graph", "succeeded"],
      ["plan", "succeeded"],
      ["check", "succeeded"],
    ]);
    // The planner is told where the graph is and gets the schema; only the plan is published.
    const planner = agents.specs.find(planningTask);
    expect(planner?.task).toContain("scratch/demo/understand/graph.json");
    expect(planner?.task).toContain("Return your result as JSON matching this schema");
    expect(artifacts).toEqual(["applications/demo/understanding/plan.md"]);
    const plan = readFileSync(join(root, "applications", "demo", "understanding", "plan.md"), "utf8");
    expect(documentOf(plan).data).toMatchObject({ version: 1, app: "demo", batches: 2, planned: 2 });
    expect(plan).toMatch(/## Batch 1: Rates[\s\S]*- `rates\/rates`[\s\S]*## Batch 2: Entry[\s\S]*- `billing\/main`/);
    expect(plan).toContain("| nope/x | not an item of the catalog |");
    // main depends on rates, which the earlier batch holds: nothing is left outside.
    expect(plan).not.toContain("### Depends on outside");
    // Advice, not a proposal: it is not sent to review.
    expect(writes).toHaveLength(1);
    expect(writes[0]?.reviewAll).toBeUndefined();
  }, 120_000);

  it("sends the planner back once with the check's reason when nothing in its plan can stand", async () => {
    let calls = 0;
    const good = { strategy: "Rates.", batches: [{ title: "Rates", items: ["rates/rates"], rationale: "Foundation.", risk: "high" }] };
    const bad = { strategy: "Nothing.", batches: [{ title: "Unknown", items: ["nope/x"], rationale: "", risk: "low" }] };
    const { run, summary, agents } = await runStage("plan-understand", {
      legacy: "small",
      docs: "cataloged-small-docs",
      files: { "understand-planner": (spec): Record<string, string> => (planningTask(spec) ? { "result.json": JSON.stringify(++calls === 1 ? bad : good) } : {}) },
    });
    expect(run?.status).toBe("succeeded");
    expect(summary?.steps.map((step) => step.id)).toEqual(["graph", "plan", "check", "plan-fix", "check"]);
    const repair = agents.specs.filter(planningTask).at(-1);
    expect(repair?.task).toContain("no batch is left");
  }, 120_000);

  it("names the pull request after the module when one module's items are selected", () => {
    expect(understandMessage("billing", { items: ["invoicing/a", "invoicing/b"], files: [] })).toBe("Understand billing: invoicing (2 items)");
    expect(understandMessage("billing", { items: ["a/x", "b/y", "c/z", "d/w"], files: [] })).toBe("Understand billing: x, y +2");
  });

  it("fails understand without a selection, and before any step without a catalog", async () => {
    const empty = await runStage("understand", { legacy: "small", docs: "cataloged-small-docs" });
    expect(empty.run?.status).toBe("failed");
    expect(empty.run?.failureReason).toContain("needs a selection of catalog items");
    expect(empty.writes).toHaveLength(0);
    const { run, store, id, writes } = await runStage("understand", { legacy: "small", inputs: { scope: { items: ["billing/main"], files: [] } } });
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toBe(
      "applications/demo/assessment/catalog/index.md is not on the default branch of the document repository: run the assess stage first and merge its pull request, then run understand again",
    );
    expect(store.children(id)).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it("rebuilds the generated views from the per-item files: script only, everything under generated/", async () => {
    const { run, writes, artifacts, root } = await runStage("rebuild", { legacy: "small", docs: "understood-docs" });
    expect(run?.failureReason).toBeUndefined();
    expect(run?.status).toBe("succeeded");
    expect(artifacts).toEqual([
      "applications/demo/generated/BUSINESS_RULES.md",
      "applications/demo/generated/DATA_OBJECTS.md",
      "applications/demo/generated/README.md",
      "applications/demo/generated/SECURITY_FINDINGS.md",
      "applications/demo/generated/traceability.md",
    ]);
    // Every output is under the default autoCommitPaths: the writer commits it without a pull request.
    expect(artifacts.every((path) => isAutoCommitPath(path, DEFAULT_AUTO_COMMIT_PATHS))).toBe(true);
    expect(readFileSync(join(root, "applications", "demo", "generated", "BUSINESS_RULES.md"), "utf8")).toContain("### RULE-rates.rates-1a2b3c4d: Double large amounts");
    expect(documentOf(readFileSync(join(root, "applications", "demo", "generated", "traceability.md"), "utf8")).data).toMatchObject({ items: 2, units: 1, rulesCovered: 1 });
    expect(writes[0]).toMatchObject({ message: "Rebuild the generated views of demo from its understood units" });
    // The rebuild must stage the per-unit evidence tree, or the aggregates come out empty.
    expect(REBUILD.documents).toContain("applications/{app}/units/");
  }, 120_000);

  it("finds the applications whose items a default-branch move touched", () => {
    expect(
      appsTouched([
        "applications/web/units/a/b/understanding/rules.md",
        "applications/shop/units/x/y/understanding/understanding.md",
        "applications/web/generated/traceability.md",
        "applications/web/units/a/b/unit.md",
        "applications/Bad/units/a/b/c.md",
      ]),
    ).toEqual(["shop", "web"]);
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
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "stage", name: "assess", sourceRepositoryId: "small", inputs: {} });
    const run = await runner.run(id);
    expect(run?.failureReason).toMatch(/^Step analysis failed: (structure|debt|security): Agent (legacy-analyst|security-auditor) did not write applications\/demo\/assessment\/analysis\//);
  });
});
