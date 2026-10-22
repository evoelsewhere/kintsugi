// Job runs end to end in job workspaces (ADR-0029), on every OS and without a database: a
// fixture legacy repository, the built-in inventory script, the mock agent backend (with the
// files a real agent would write), the JobOutput hook, restricted records and the hand-off
// to the document repo writer. The Postgres store and the queue are covered in
// job-runs.test.ts.

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { documentOf, parseItemCatalog } from "@kintsugi/agents/reader";
import { CheckoutStorage } from "@kintsugi/git";
import { createChildAgentRuntime, interpretersFromEnv } from "@kintsugi/runtime/launcher";
import type { JobSpec } from "@kintsugi/runtime-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";
import { JobCancelled } from "../src/jobs/model.js";
import { JobRunner, summarizeToolCall } from "../src/jobs/runner.js";
import type { DocumentWriteRequest } from "../src/queues.js";
import { type AgentFiles, LocalCheckouts, MemoryJobStore, fixtureRepository, writingAgentRuntime } from "./support/jobs.js";

const LEGACY_FILES = {
  "src/main.c": "int main(void) {\n  if (1) { return 0; }\n  return 1;\n}\n",
  "src/util.c": "int add(int a, int b) { for (;;) { return a + b; } }\n",
  "README.md": "# Demo\n",
};
const DOCUMENT_FILES = {
  "kintsugi.yaml": "version: 1\nproject: { id: demo }\n",
  "10-applications/demo/00-inputs/INTENT.md": "Move to a supported platform.\n",
};

describe("job runs in job workspaces (mock agent, fixture repositories)", () => {
  let legacy: ReturnType<typeof fixtureRepository>;
  let docs: ReturnType<typeof fixtureRepository>;
  let dataDir: string;
  let storage: CheckoutStorage;

  beforeAll(async () => {
    legacy = fixtureRepository(LEGACY_FILES);
    docs = fixtureRepository(DOCUMENT_FILES);
    dataDir = mkdtempSync(join(tmpdir(), "kintsugi-jobs-data-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
  });
  afterAll(async () => {
    await legacy?.remove();
    await docs?.remove();
    await rm(dataDir, { recursive: true, force: true });
  });

  function setup(files: AgentFiles, mockOutputs?: boolean): { store: MemoryJobStore; runner: JobRunner; writes: Array<{ repository: string; request: DocumentWriteRequest }>; agents: ReturnType<typeof writingAgentRuntime>; checkouts: LocalCheckouts } {
    const store = new MemoryJobStore();
    const writes: Array<{ repository: string; request: DocumentWriteRequest }> = [];
    const agents = writingAgentRuntime(files);
    const checkouts = new LocalCheckouts({ legacy: legacy.bare, docs: docs.bare });
    const runner = new JobRunner({
      store,
      storage,
      checkouts,
      agents,
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      ...(mockOutputs === undefined ? {} : { mockOutputs }),
      requestWrite: async (repository, request) => {
        writes.push({ repository, request });
      },
      log: () => undefined,
    });
    return { store, runner, writes, agents, checkouts };
  }

  const assess = async (store: MemoryJobStore): Promise<string> => {
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "stage", name: "assess", sourceRepositoryId: "legacy", actor: "alice" });
    return id;
  };

  const synthesis = (spec: JobSpec): boolean => spec.task.startsWith("Write the assessment of application");

  it("runs the assess stage: inventory script, three analysis jobs, synthesis job, hook, restricted record, document write", async () => {
    const seen: { inventory?: { sourceFileCount: number }; intent?: string; structure?: string; srcWritable?: boolean } = {};
    const { store, runner, writes, agents } = setup({
      "legacy-analyst": (spec: JobSpec): Record<string, string> => {
        if (!synthesis(spec)) return spec.task.startsWith("Build the structural map") ? { "10-applications/demo/01-legacy/_analysis/structure.md": "# Structure\n\n| domain | files |\n" } : {};
        const [src, inputs] = spec.workspace.readOnly as [string, string];
        seen.structure = readFileSync(join(inputs, "10-applications", "demo", "01-legacy", "_analysis", "structure.md"), "utf8");
        seen.inventory = documentOf(readFileSync(join(inputs, "10-applications", "demo", "01-legacy", "inventory.md"), "utf8")).data as unknown as { sourceFileCount: number };
        seen.intent = readFileSync(join(inputs, "10-applications", "demo", "00-inputs", "INTENT.md"), "utf8");
        try {
          writeFileSync(join(src, "legacy", "src", "main.c"), "tampered");
          seen.srcWritable = true;
        } catch {
          seen.srcWritable = false;
        }
        return {
          "10-applications/demo/01-legacy/assessment.md": `# Assessment (draft)\n\n${seen.inventory.sourceFileCount} source files.\n`,
          "restricted/SECRETS.local.md": "| preview | location |\n|---|---|\n| hu** | src/main.c:2 |\n",
        };
      },
    });
    const id = await assess(store);
    const run = await runner.run(id);

    expect(run).toMatchObject({ status: "succeeded", kind: "stage", name: "assess" });
    expect(run?.sourceCommit).toMatch(/^[0-9a-f]{40}$/);

    // Steps: the script with its hash, three analysis jobs, the topology extraction, the item catalog, then the synthesis job.
    const children = store.children(id);
    expect(children.map((child) => [child.kind, child.name, child.inputs["label"] ?? null, child.status])).toEqual([
      ["script", "inventory.py", null, "succeeded"],
      ["agent", "legacy-analyst", "structure", "succeeded"],
      ["agent", "legacy-analyst", "debt", "succeeded"],
      ["agent", "security-auditor", "security", "succeeded"],
      ["agent", "legacy-analyst", "topology", "succeeded"],
      ["script", "extract_topology.py", null, "succeeded"],
      ["script", "render_topology.py", null, "succeeded"],
      ["script", "catalog_from_topology.py", null, "succeeded"],
      ["agent", "legacy-analyst", "catalog-curate", "succeeded"],
      ["script", "apply_catalog_edits.py", null, "succeeded"],
      ["script", "reconcile_catalog.py", null, "succeeded"],
      ["script", "render_catalog.py", null, "succeeded"],
      ["agent", "legacy-analyst", "synthesis", "succeeded"],
      ["script", "style_architecture.py", null, "succeeded"],
    ]);
    const [script] = children;
    const agent = children.at(-2);
    expect(script?.sourceCommit).toBe(run?.sourceCommit);
    expect(script?.scriptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(agent?.agent).toBe("legacy-analyst@1.1.0");

    // The synthesis read the script's output, the analysis notes and the declared document as read-only inputs, and could not change the source.
    expect(seen.inventory?.sourceFileCount).toBe(3);
    expect(seen.intent).toContain("supported platform");
    expect(seen.structure).toContain("| domain | files |");
    if (process.platform === "win32" || process.getuid?.() !== 0) expect(seen.srcWritable).toBe(false);
    const spec = agents.specs.find(synthesis)!;
    expect(spec.model).toEqual({ provider: "mock", id: "mock" });
    expect(spec.task).toContain("10-applications/demo/01-legacy/assessment.md");
    expect(spec.task).not.toMatch(/\{(app|repo|commit|in)\}/);

    // out/ holds what goes to Git (not the intermediate notes); restricted/ went to the restricted record only.
    const out = storage.job(id).out;
    expect(existsSync(join(out, "10-applications", "demo", "01-legacy", "inventory.md"))).toBe(true);
    expect(readFileSync(join(out, "10-applications", "demo", "01-legacy", "assessment.md"), "utf8")).toContain("3 source files");
    expect(existsSync(join(out, "10-applications", "demo", "01-legacy", "_analysis"))).toBe(false);
    // The per-file inventory, the raw topology and the catalog drafts are scratch of the run: not in out/.
    expect(existsSync(join(out, "scratch"))).toBe(false);
    // The item catalog: every inventory file in one item or unassigned (mock topology: one module per top folder).
    const catalogDir = join(out, "10-applications", "demo", "01-legacy", "_catalog");
    const catalogIndex = readFileSync(join(catalogDir, "index.md"), "utf8");
    const catalog = parseItemCatalog(catalogIndex, { legacy: readFileSync(join(catalogDir, "legacy.md"), "utf8") })!;
    expect(documentOf(catalogIndex).data["generatedBy"]).toBe("reconcile_catalog.py");
    expect(catalog.items.map((item) => [item.id, item.files, item.status])).toEqual([["legacy/src", ["legacy/src/main.c", "legacy/src/util.c"], "active"]]);
    expect(catalog.items[0]?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(catalog.unassigned).toEqual(["legacy/README.md"]);
    expect(existsSync(join(out, "restricted"))).toBe(false);
    expect(store.restricted.get(agent!.id)?.get("SECRETS.local.md")).toContain("hu**");
    expect(JSON.stringify(run?.outputSummary)).not.toContain("SECRETS");

    // Artifact index with provenance per producer.
    const artifacts = store.artifacts.get(id) ?? [];
    expect(artifacts.map((entry) => entry.path).sort()).toEqual([
      "10-applications/demo/01-legacy/_catalog/index.md",
      "10-applications/demo/01-legacy/_catalog/legacy.md",
      "10-applications/demo/01-legacy/_tools/extract_topology.py",
      "10-applications/demo/01-legacy/architecture.mmd",
      "10-applications/demo/01-legacy/assessment.md",
      "10-applications/demo/01-legacy/inventory.md",
      "10-applications/demo/01-legacy/topology.md",
    ]);
    expect(artifacts.find((entry) => entry.path.endsWith("inventory.md"))?.provenance).toMatchObject({ origin: "tool" });
    expect(artifacts.find((entry) => entry.path.endsWith("assessment.md"))?.provenance).toMatchObject({ origin: "runtime-agent", runtimeAgent: "legacy-analyst", model: "mock/mock" });

    // Handed to the writer: the stage's out/, with job, agent and actor provenance.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      repository: "docs",
      request: { projectId: "demo", kind: "job-output", outputOfJob: id, jobId: id, agent: "legacy-analyst@1.1.0", actor: "alice", message: "Assess demo: inventory, item catalog and assessment" },
    });
    expect(run?.documentWriteId).toBe(writes[0]?.request.writeId);

    // The checkout, inputs, scratch, the intermediate outputs and the steps' folders are gone; out/ stays for the writer,
    // with the manifest, the guide and the ledger that say what the workspace was.
    const left = await readdir(storage.job(id).root);
    expect(left.sort()).toEqual([".state", "WORKSPACE.md", "out", "workspace.json"]);
    expect(JSON.parse(readFileSync(storage.job(id).manifest, "utf8"))).toMatchObject({ jobId: id, attempt: 1, state: "published", sources: [{ repositoryId: "legacy", role: "legacy" }] });
    expect(existsSync(storage.job(id).steps)).toBe(false);
  });

  const BAD_TOPOLOGY = { "10-applications/demo/01-legacy/topology.md": "# Topology without front matter\n" };
  const GOOD_TOPOLOGY = '---\napp: "demo"\nsystem: "demo"\n---\n# Topology of demo\n\n## Domains\n\n| Domain | Leaves | Data stores | LOC |\n| --- | --- | --- | --- |\n| Core | 1 | 0 | 5 |\n';

  it("keeps a credential an agent left in its files as written", async () => {
    const { store, runner, writes, agents } = setup({
      "legacy-analyst": (spec): Record<string, string> => (synthesis(spec) ? { "10-applications/demo/01-legacy/assessment.md": "Config: password = hunter2hunter2\n" } : {}),
    });
    const id = await assess(store);
    const run = await runner.run(id);
    expect(run?.status).toBe("succeeded");
    expect(agents.specs.filter(synthesis)).toHaveLength(1);
    expect(writes).toHaveLength(1);
    const text = readFileSync(join(storage.job(id).out, "10-applications", "demo", "01-legacy", "assessment.md"), "utf8");
    expect(text).toBe("Config: password = hunter2hunter2\n");
    expect(store.events.some((event) => event.message.startsWith("masked "))).toBe(false);
  });

  it("still fails closed for what is not a credential: a malformed artifact, with a redacted reason and no write", async () => {
    const { store, runner, writes } = setup({ "legacy-analyst": (spec): Record<string, string> => (synthesis(spec) ? BAD_TOPOLOGY : {}) });
    const id = await assess(store);
    const run = await runner.run(id);
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toMatch(/^Step synthesis failed: JobOutput hook blocked the output: malformed artifact found — invalid_topology_document at 10-applications\/demo\/01-legacy\/topology\.md:1/);
    expect(writes).toHaveLength(0);
    expect(store.children(id).map((child) => child.status)).toEqual([...Array<string>(12).fill("succeeded"), "failed"]);
  });

  it("gives an agent the redacted findings and one retry when the hook flags its files", async () => {
    const { store, runner, writes, agents } = setup({
      "legacy-analyst": (spec): Record<string, string> => {
        if (!synthesis(spec)) return {};
        return spec.task.includes("The output checks rejected the files you wrote") ? { "10-applications/demo/01-legacy/topology.md": GOOD_TOPOLOGY } : BAD_TOPOLOGY;
      },
    });
    const id = await assess(store);
    const run = await runner.run(id);
    expect(run?.status).toBe("succeeded");
    expect(writes).toHaveLength(1);
    const attempts = agents.specs.filter(synthesis);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.task).toMatch(/- invalid_topology_document at 10-applications\/demo\/01-legacy\/topology\.md:1\n/);
  });

  it("fails after the one retry when the agent keeps the artifact malformed", async () => {
    const { store, runner, writes, agents } = setup({ "legacy-analyst": (spec): Record<string, string> => (synthesis(spec) ? BAD_TOPOLOGY : {}) });
    const id = await assess(store);
    const run = await runner.run(id);
    expect(run?.status).toBe("failed");
    expect(agents.specs.filter(synthesis)).toHaveLength(2);
    expect(writes).toHaveLength(0);
  });

  it("retries a failed job in its own workspace: keeps work/ and the checkouts, skips the steps that did not change, reruns the scripts and the failed step", async () => {
    let fail = true;
    const { store, runner, writes, checkouts } = setup({
      "legacy-analyst": (spec): Record<string, string> => (synthesis(spec) ? (fail ? BAD_TOPOLOGY : { "10-applications/demo/01-legacy/assessment.md": "# Assessment\n" }) : {}),
    });
    const id = await assess(store);
    expect((await runner.run(id))?.status).toBe("failed");
    // The failed job keeps its steps in the summary, work/ beside out/, its checkouts, and says it can be retried.
    const failed = await store.get(id);
    const steps = (failed?.outputSummary?.["steps"] ?? []) as Array<{ id: string; status: string }>;
    expect(steps.map((step) => [step.id, step.status]).at(-1)).toEqual(["synthesis", "failed"]);
    expect(failed?.outputSummary?.["documentsCommit"]).toMatch(/^[0-9a-f]{40}$/);
    const paths = storage.job(id);
    expect(existsSync(join(paths.work, "10-applications", "demo", "01-legacy", "_analysis"))).toBe(true);
    expect(existsSync(join(paths.asIs, "legacy", "src", "main.c"))).toBe(true);
    expect(JSON.parse(readFileSync(paths.manifest, "utf8"))).toMatchObject({ attempt: 1, state: "parked" });
    const ledger = JSON.parse(readFileSync(paths.ledger, "utf8")) as { entries: Record<string, { status: string; attempt: number }> };
    expect(Object.entries(ledger.entries).filter(([, entry]) => entry.status === "succeeded" && entry.attempt === 1).map(([key]) => key)).toEqual(expect.arrayContaining(["structure", "debt", "security", "topology", "catalog-curate"]));
    expect(ledger.entries["synthesis"]?.status).toBe("failed");
    expect(checkouts.checkouts).toHaveLength(1);

    // The same job, the next attempt.
    fail = false;
    const before = store.children(id).length;
    store.requeue(id);
    const retried = await runner.run(id);
    expect(retried?.failureReason).toBeUndefined();
    expect(retried?.status).toBe("succeeded");
    expect(retried?.attempt).toBe(2);
    // The checkout was kept; only the scripts and the synthesis ran again.
    expect(checkouts.checkouts).toHaveLength(1);
    expect(store.children(id).slice(before).map((child) => [child.kind, child.inputs["label"] ?? child.name])).toEqual([
      ["script", "inventory.py"],
      ["script", "extract_topology.py"],
      ["script", "render_topology.py"],
      ["script", "catalog_from_topology.py"],
      ["script", "apply_catalog_edits.py"],
      ["script", "reconcile_catalog.py"],
      ["script", "render_catalog.py"],
      ["agent", "synthesis"],
      ["script", "style_architecture.py"],
    ]);
    const summary = retried?.outputSummary as { attempt: number; steps: Array<{ id: string; reused?: boolean }> };
    expect(summary.attempt).toBe(2);
    expect(summary.steps.filter((step) => step.reused === true).map((step) => step.id).sort()).toEqual(["catalog-curate", "debt", "security", "structure", "topology"]);
    const out = paths.out;
    expect(existsSync(join(out, "10-applications", "demo", "01-legacy", "_tools", "extract_topology.py"))).toBe(true);
    expect(readFileSync(join(out, "10-applications", "demo", "01-legacy", "assessment.md"), "utf8")).toBe("# Assessment\n");
    expect(writes).toHaveLength(1);
    // The events carry the attempt they belong to.
    expect(store.events.filter((event) => event.kind === "status").map((event) => event.attempt)).toEqual(expect.arrayContaining([1, 2]));
  }, 120_000);

  it("runs the steps again when the job is retried from scratch", async () => {
    let fail = true;
    const { store, runner, agents } = setup({ "legacy-analyst": (spec): Record<string, string> => (synthesis(spec) && fail ? BAD_TOPOLOGY : {}) });
    const id = await assess(store);
    expect((await runner.run(id))?.status).toBe("failed");
    const analysts = (): number => agents.specs.filter((spec) => spec.agent.id === "legacy-analyst" || spec.agent.id === "security-auditor").length;
    const first = analysts();

    fail = false;
    store.requeue(id, { fresh: true });
    expect((await runner.run(id))?.status).toBe("succeeded");
    // The five agent steps before the synthesis run again, and the synthesis once more.
    expect(analysts() - first).toBeGreaterThanOrEqual(6);
  }, 180_000);

  it("fails clearly when an agent has no model binding on the pi runtime", async () => {
    const { store, writes } = setup({});
    const runner = new JobRunner({
      store,
      storage,
      checkouts: new LocalCheckouts({ legacy: legacy.bare, docs: docs.bare }),
      agents: { engine: "pi@test", startJob: () => Promise.reject(new Error("must not start")) },
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      requestWrite: async () => undefined,
      log: () => undefined,
    });
    const id = await assess(store);
    const run = await runner.run(id);
    expect(run?.status).toBe("failed");
    // The group stops at its first failure, whichever of the three analysis jobs that is.
    expect(run?.failureReason).toMatch(/^Step analysis failed: (structure|debt|security): No model is bound to agent "(legacy-analyst|security-auditor)" \(Settings → LLM Providers\) \(and 2 more\)$/);
    expect(writes).toHaveLength(0);
  });

  describe("an agent that misplaces an expected file", () => {
    const EXPECTED = "10-applications/demo/01-legacy/assessment.md";
    const agentRun = async (files: AgentFiles) => {
      const { store, agents } = setup(files);
      const runner = new JobRunner({
        store,
        storage,
        checkouts: new LocalCheckouts({ legacy: legacy.bare, docs: docs.bare }),
        agents,
        agentDefinitions: builtinAgents(),
        interpreters: interpretersFromEnv(),
        mockOutputs: false,
        requestWrite: async () => undefined,
        log: () => undefined,
      });
      const id = randomUUID();
      await store.create({ id, projectId: "demo", applicationId: "demo", kind: "agent", name: "legacy-analyst", sourceRepositoryId: "legacy", inputs: { task: "Write it.", expects: [EXPECTED] } });
      const run = await runner.run(id);
      return { id, run, agents, logs: store.events.filter((event) => event.runId === id && event.kind === "log").map((event) => event.message) };
    };

    it("moves a bare-named file into place without asking the agent again", async () => {
      const { id, run, agents, logs } = await agentRun({ "legacy-analyst": () => ({ "assessment.md": "# Assessment\n" }) });
      expect(run?.status).toBe("succeeded");
      expect(agents.specs).toHaveLength(1);
      expect(logs.some((line) => line.includes("moved into place"))).toBe(true);
      expect(readFileSync(join(storage.job(id).out, ...EXPECTED.split("/")), "utf8")).toBe("# Assessment\n");
      expect(existsSync(join(storage.job(id).out, "assessment.md"))).toBe(false);
    });

    it("picks, among several files of the expected name, the one whose path matches best", async () => {
      const { id, run, agents } = await agentRun({
        "legacy-analyst": () => ({ "01-legacy/assessment.md": "# Right\n", "other/assessment.md": "# Wrong\n" }),
      });
      expect(run?.status).toBe("succeeded");
      expect(agents.specs).toHaveLength(1);
      expect(readFileSync(join(storage.job(id).out, ...EXPECTED.split("/")), "utf8")).toBe("# Right\n");
    });

    it("asks the agent once, naming the exact paths, when nothing usable was written", async () => {
      let calls = 0;
      const { run, agents } = await agentRun({
        "legacy-analyst": (): Record<string, string> => {
          calls += 1;
          return calls === 1 ? { "notes.md": "x" } : { [EXPECTED]: "# Assessment\n" };
        },
      });
      expect(run?.status).toBe("succeeded");
      expect(agents.specs).toHaveLength(2);
      expect(agents.specs[1]?.task).toContain(`- ${EXPECTED}`);
      expect(agents.specs[1]?.task).toContain("notes.md");
    });

    it("fails after the one repair attempt when the file is still missing", async () => {
      const { run, agents } = await agentRun({});
      expect(run?.status).toBe("failed");
      expect(run?.failureReason).toBe(`Agent legacy-analyst did not write ${EXPECTED}`);
      expect(agents.specs).toHaveLength(2);
    });
  });

  it("records a failing script step with its exit code", async () => {
    const { store, runner } = setup({});
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "script", name: "inventory.py", sourceRepositoryId: "legacy", inputs: { args: ["--source", "{src}"] } });
    const run = await runner.run(id);
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toMatch(/^Script inventory\.py exited with code 2/);
    expect(run?.scriptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("runs a model-written script from the inputs the same way as a built-in one", async () => {
    const { store, writes } = setup({});
    // A previous job's output, published to the document repo, becomes this step's input.
    const scriptRepo = fixtureRepository({ "10-applications/demo/01-legacy/extract_topology.py": "import json, os, sys\nos.makedirs(sys.argv[1], exist_ok=True)\njson.dump({'ok': True}, open(os.path.join(sys.argv[1], 'nodes.json'), 'w'))\n" });
    try {
      const runnerWithDocs = new JobRunner({
        store,
        storage,
        checkouts: new LocalCheckouts({ legacy: legacy.bare, docs: scriptRepo.bare }),
        agents: writingAgentRuntime({}),
        agentDefinitions: builtinAgents(),
        interpreters: interpretersFromEnv(),
        requestWrite: async (repository, request) => {
          writes.push({ repository, request });
        },
        log: () => undefined,
      });
      const id = randomUUID();
      await store.create({
        id,
        projectId: "demo",
        applicationId: "demo",
        kind: "script",
        name: "extract_topology.py",
        sourceRepositoryId: "legacy",
        inputs: { documents: ["10-applications/{app}/01-legacy/extract_topology.py"], scriptFromInputs: "10-applications/demo/01-legacy/extract_topology.py", args: ["{out}/applications/{app}/assessment/scratch"] },
      });
      const run = await runnerWithDocs.run(id);
      expect(run?.failureReason).toBeUndefined();
      expect(run?.status).toBe("succeeded");
      expect(run?.scriptHash).toMatch(/^[0-9a-f]{64}$/);
      expect(writes.at(-1)?.request).toMatchObject({ outputOfJob: id, message: "Output of script extract_topology.py" });
    } finally {
      await scriptRepo.remove();
    }
  });

  it("runs a built-in workflow with agent jobs as child runs, within the agent cap", async () => {
    const { store, runner } = setup({
      "legacy-analyst": () => ({ "result.json": JSON.stringify({ depManifest: "none", depFreshness: "n/a", docCoveragePct: 50, riskNotes: ["fixture"] }) }),
    });
    const id = randomUUID();
    const inventory = { sloc: 2000, fileCount: 3, complexityTotal: 10, maxFileComplexity: 4, dominantLanguage: "C", metricsTool: "inventory.py" };
    await store.create({
      id,
      projectId: "demo",
      kind: "workflow",
      name: "portfolio-assess",
      sourceRepositoryId: "legacy",
      inputs: { args: { apps: ["alpha", "beta"], inventories: { alpha: inventory, beta: inventory } } },
    });
    const run = await runner.run(id);
    expect(run?.status).toBe("succeeded");
    const summary = run?.outputSummary as { agents: number; result: { rows: Array<{ app: string; docCoveragePct: number; complexityIndex: number }> } };
    expect(summary.agents).toBe(2);
    expect(summary.result.rows.map((row) => row.app).sort()).toEqual(["alpha", "beta"]);
    expect(summary.result.rows[0]).toMatchObject({ docCoveragePct: 50, complexityIndex: 6.3 });
    expect(store.children(id).map((child) => [child.kind, child.name, child.status])).toEqual([
      ["agent", "legacy-analyst", "succeeded"],
      ["agent", "legacy-analyst", "succeeded"],
    ]);
  });

  it("takes an agent's result.json from a folder, and asks once more when it is missing", async () => {
    const inventory = { sloc: 2000, fileCount: 3, complexityTotal: 10, maxFileComplexity: 4, dominantLanguage: "C", metricsTool: "inventory.py" };
    const result = JSON.stringify({ depManifest: "none", depFreshness: "n/a", docCoveragePct: 50, riskNotes: ["fixture"] });
    const run = async (files: (call: number) => Record<string, string>) => {
      let call = 0;
      const { store, runner, agents } = setup({ "legacy-analyst": () => files(call++) }, false);
      const id = randomUUID();
      await store.create({ id, projectId: "demo", kind: "workflow", name: "portfolio-assess", sourceRepositoryId: "legacy", inputs: { args: { apps: ["alpha"], inventories: { alpha: inventory } } } });
      return { run: await runner.run(id), agents };
    };

    const folder = await run(() => ({ "10-applications/alpha/01-legacy/result.json": result }));
    expect(folder.run?.status).toBe("succeeded");
    expect(folder.agents.specs).toHaveLength(1);

    const retried = await run((call): Record<string, string> => (call === 0 ? {} : { "result.json": result }));
    expect(retried.run?.status).toBe("succeeded");
    expect(retried.agents.specs).toHaveLength(2);
    expect(retried.agents.specs[1]?.task).toContain('bare path "result.json"');
  });

  it("keeps no copy of result.json, prefers the root one, and sends a wrongly shaped result back once", async () => {
    const inventory = { sloc: 2000, fileCount: 3, complexityTotal: 10, maxFileComplexity: 4, dominantLanguage: "C", metricsTool: "inventory.py" };
    const good = JSON.stringify({ depManifest: "none", depFreshness: "n/a", docCoveragePct: 50, riskNotes: ["fixture"] });
    const run = async (files: (call: number) => Record<string, string>) => {
      let call = 0;
      const { store, runner, agents } = setup({ "legacy-analyst": () => files(call++) }, false);
      const id = randomUUID();
      await store.create({ id, projectId: "demo", kind: "workflow", name: "portfolio-assess", sourceRepositoryId: "legacy", inputs: { args: { apps: ["alpha"], inventories: { alpha: inventory } } } });
      const finished = await runner.run(id);
      const left = existsSync(storage.job(id).out) ? (readdirSync(storage.job(id).out, { recursive: true }) as string[]).filter((path) => path.endsWith("result.json")) : [];
      return { run: finished, agents, left, failures: store.children(id).flatMap((child) => (child.failureReason === undefined ? [] : [child.failureReason])) };
    };

    // Root file and a stray copy in a folder: the root one is the result, and nothing is left behind.
    const both = await run(() => ({ "result.json": good, "10-applications/alpha/01-legacy/result.json": "not json" }));
    expect(both.run?.status).toBe("succeeded");
    expect(both.agents.specs).toHaveLength(1);
    expect(both.left).toEqual([]);

    // A valid file in a folder wins over an invalid root file.
    const folder = await run(() => ({ "result.json": "{", "10-applications/alpha/01-legacy/result.json": good }));
    expect(folder.run?.status).toBe("succeeded");
    expect(folder.agents.specs).toHaveLength(1);

    // An empty object lacks the required properties: one repair attempt, which says why.
    const empty = await run((call) => ({ "result.json": call === 0 ? "{}" : good }));
    expect(empty.run?.status).toBe("succeeded");
    expect(empty.agents.specs).toHaveLength(2);
    expect(empty.agents.specs[1]?.task).toContain("does not match the schema (missing");

    // Still wrong after the repair attempt: the step fails and says what was wrong.
    const hopeless = await run(() => ({ "result.json": "{}" }));
    expect(hopeless.agents.specs).toHaveLength(2);
    expect(hopeless.failures.join(" | ")).toContain("an invalid result.json: result.json does not match the schema");
  });

  it("records the run's live events: status, steps and agent tool calls, without file content", async () => {
    const { store, runner } = setup({ "legacy-analyst": (spec): Record<string, string> => (synthesis(spec) ? { "10-applications/demo/01-legacy/assessment.md": "# Draft with private detail\n" } : {}) });
    const id = await assess(store);
    await runner.run(id);
    const events = store.events.filter((event) => event.runId === id);
    const children = store.children(id);
    expect(events[0]).toMatchObject({ kind: "status", data: { status: "running" } });
    expect(events.at(-1)).toMatchObject({ kind: "status", data: { status: "succeeded" } });
    const steps = events.filter((event) => event.kind.startsWith("step."));
    expect(steps).toHaveLength(2 * children.length);
    for (const child of children) {
      expect(steps.filter((event) => event.stepId === child.id).map((event) => [event.kind, event.data?.["status"] ?? null])).toEqual([
        ["step.started", null],
        ["step.finished", "succeeded"],
      ]);
    }
    const agentIds = new Set(children.filter((child) => child.kind === "agent").map((child) => child.id));
    const tools = events.filter((event) => event.kind === "tool");
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((event) => agentIds.has(event.stepId ?? ""))).toBe(true);
    expect(JSON.stringify(events)).not.toContain("private detail");
  });

  it("summarizes tool calls by tool and workspace path only", () => {
    const roots = { src: join(dataDir, "jobs", "x", "src"), out: join(dataDir, "jobs", "x", "out") };
    expect(summarizeToolCall("read", { path: join(roots.src, "lib", "a.c") }, roots)).toBe("read src/lib/a.c");
    expect(summarizeToolCall("write", { path: "assessment/x.md", content: "secret body" }, roots)).toBe("write assessment/x.md");
    expect(summarizeToolCall("edit", { path: "assessment/x.md", edits: [{ oldText: "secret", newText: "body" }] }, roots)).toBe("edit assessment/x.md");
    expect(summarizeToolCall("grep", { path: roots.src, pattern: "TODO" }, roots)).toBe('grep src "TODO"');
    expect(summarizeToolCall("read", { path: join(tmpdir(), "elsewhere.txt") }, roots)).toBe("read (outside the workspace)");
    const script = ['// @options: {"timeout_ms": 1000}', 'const files = await ls({ path: "src" });', "console.log(files);"].join("\n");
    expect(summarizeToolCall("codemode", { code: script }, roots)).toBe('codemode const files = await ls({ path: "src" }); …');
    expect(summarizeToolCall("shell", { command: "wc -l src/*.c\nrm tmp" }, roots)).toBe("shell wc -l src/*.c …");
    expect(summarizeToolCall("git", { args: ["log", "--oneline", "-5"] }, roots)).toBe("git log --oneline -5");
    expect(summarizeToolCall("mcp__tracker__search", { query: "login", limit: 5, body: { text: "private" } }, roots)).toBe("mcp__tracker__search query=login limit=5");
  });

  it("does not start a run that was cancelled while queued", async () => {
    const { store, runner } = setup({});
    const id = await assess(store);
    await store.cancel(id);
    const run = await runner.run(id);
    expect(run?.status).toBe("cancelled");
    expect(store.children(id)).toHaveLength(0);
    expect(existsSync(storage.job(id).root)).toBe(false);
  });

  it("cancels a running stage: kills the agent's process, cancels the step and the run, writes nothing", async () => {
    const hang = join(dataDir, "hang.mjs");
    writeFileSync(hang, "setInterval(() => undefined, 1000);\n");
    const store = new MemoryJobStore();
    const writes: DocumentWriteRequest[] = [];
    const runner = new JobRunner({
      store,
      storage,
      checkouts: new LocalCheckouts({ legacy: legacy.bare, docs: docs.bare }),
      agents: createChildAgentRuntime({ mode: "mock", entry: hang }),
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      requestWrite: async (_repository, request) => {
        writes.push(request);
      },
      log: () => undefined,
    });
    const id = await assess(store);
    const cancel = new AbortController();
    const running = runner.run(id, cancel.signal);
    await expect.poll(() => store.events.some((event) => event.kind === "step.started" && event.data?.["kind"] === "agent"), { timeout: 30_000, interval: 50 }).toBe(true);
    cancel.abort(new JobCancelled());
    const run = await running;
    expect(run?.status).toBe("cancelled");
    const [script, ...agents] = store.children(id).map((child) => [child.kind, child.status]);
    expect(script).toEqual(["script", "succeeded"]);
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) expect(agent).toEqual(["agent", "cancelled"]);
    expect(writes).toHaveLength(0);
    expect(store.events.at(-1)).toMatchObject({ runId: id, kind: "status", data: { status: "cancelled" } });
  }, 60_000);
});
