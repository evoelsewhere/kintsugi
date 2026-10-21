// Job runs end to end in job workspaces (ADR-0029), on every OS and without a database: a
// fixture legacy repository, the built-in inventory script, the mock agent backend (with the
// files a real agent would write), the JobOutput hook, restricted records and the hand-off
// to the document repo writer. The Postgres store and the queue are covered in
// job-runs.test.ts.

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { createChildAgentRuntime, interpretersFromEnv } from "@kintsugi/runtime/launcher";
import type { JobSpec } from "@kintsugi/runtime-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";
import { DEFAULT_GATE_DECIDER, JobCancelled } from "../src/jobs/model.js";
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
  "applications/demo/assessment/INTENT.md": "Move to a supported platform.\n",
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

  function setup(files: AgentFiles): { store: MemoryJobStore; runner: JobRunner; writes: Array<{ repository: string; request: DocumentWriteRequest }>; agents: ReturnType<typeof writingAgentRuntime> } {
    const store = new MemoryJobStore();
    store.legacy = { demo: "legacy" };
    const writes: Array<{ repository: string; request: DocumentWriteRequest }> = [];
    const agents = writingAgentRuntime(files);
    const runner = new JobRunner({
      store,
      gates: DEFAULT_GATE_DECIDER,
      storage,
      checkouts: new LocalCheckouts({ legacy: legacy.bare, docs: docs.bare }),
      agents,
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      requestWrite: async (repository, request) => {
        writes.push({ repository, request });
      },
      log: () => undefined,
    });
    return { store, runner, writes, agents };
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
        if (!synthesis(spec)) return spec.task.startsWith("Build the structural map") ? { "applications/demo/assessment/analysis/structure.md": "# Structure\n\n| domain | files |\n" } : {};
        const [src, inputs] = spec.workspace.readOnly as [string, string];
        seen.structure = readFileSync(join(inputs, "applications", "demo", "assessment", "analysis", "structure.md"), "utf8");
        seen.inventory = JSON.parse(readFileSync(join(inputs, "applications", "demo", "assessment", "inventory.json"), "utf8")) as { sourceFileCount: number };
        seen.intent = readFileSync(join(inputs, "applications", "demo", "assessment", "INTENT.md"), "utf8");
        try {
          writeFileSync(join(src, "src", "main.c"), "tampered");
          seen.srcWritable = true;
        } catch {
          seen.srcWritable = false;
        }
        return {
          "applications/demo/assessment/ASSESSMENT.md": `# Assessment (draft)\n\n${seen.inventory.sourceFileCount} source files.\n`,
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
      ["script", "catalog_from_topology.py", null, "succeeded"],
      ["agent", "legacy-analyst", "catalog-curate", "succeeded"],
      ["script", "apply_catalog_edits.py", null, "succeeded"],
      ["script", "reconcile_catalog.py", null, "succeeded"],
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
    expect(spec.task).toContain("applications/demo/assessment/ASSESSMENT.md");
    expect(spec.task).not.toMatch(/\{(app|repo|commit|in)\}/);

    // out/ holds what goes to Git (not the intermediate notes); restricted/ went to the restricted record only.
    const out = storage.job(id).out;
    expect(existsSync(join(out, "applications", "demo", "assessment", "inventory.json"))).toBe(true);
    expect(readFileSync(join(out, "applications", "demo", "assessment", "ASSESSMENT.md"), "utf8")).toContain("3 source files");
    expect(existsSync(join(out, "applications", "demo", "assessment", "analysis"))).toBe(false);
    expect(existsSync(join(out, "applications", "demo", "assessment", "catalog-draft"))).toBe(false);
    // The item catalog: every inventory file in one item or unassigned (mock topology: one module per top folder).
    const catalog = JSON.parse(readFileSync(join(out, "applications", "demo", "assessment", "catalog.json"), "utf8")) as {
      generatedBy: string;
      items: Array<{ id: string; files: string[]; status: string; digest: string }>;
      unassigned: string[];
      curation?: unknown;
      reconciled: { from: string };
    };
    expect(catalog.generatedBy).toBe("reconcile_catalog.py");
    expect(catalog.items.map((item) => [item.id, item.files, item.status])).toEqual([["src/src", ["src/main.c", "src/util.c"], "active"]]);
    expect(catalog.items[0]?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(catalog.unassigned).toEqual(["README.md"]);
    expect(catalog.curation).toEqual({ applied: 0, rejected: [] });
    expect(catalog.reconciled.from).toBe("none");
    expect(existsSync(join(out, "restricted"))).toBe(false);
    expect(store.restricted.get(agent!.id)?.get("SECRETS.local.md")).toContain("hu**");
    expect(JSON.stringify(run?.outputSummary)).not.toContain("SECRETS");

    // Artifact index with provenance per producer.
    const artifacts = store.artifacts.get(id) ?? [];
    expect(artifacts.map((entry) => entry.path).sort()).toEqual([
      "applications/demo/assessment/ARCHITECTURE.mmd",
      "applications/demo/assessment/ASSESSMENT.md",
      "applications/demo/assessment/catalog.json",
      "applications/demo/assessment/inventory.json",
      "applications/demo/assessment/tools/extract_topology.py",
      "applications/demo/assessment/topology.json",
    ]);
    expect(artifacts.find((entry) => entry.path.endsWith("inventory.json"))?.provenance).toMatchObject({ origin: "tool" });
    expect(artifacts.find((entry) => entry.path.endsWith("ASSESSMENT.md"))?.provenance).toMatchObject({ origin: "runtime-agent", runtimeAgent: "legacy-analyst", model: "mock/mock" });

    // Handed to the writer: the stage's out/, with job, agent and actor provenance.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      repository: "docs",
      request: { projectId: "demo", kind: "job-output", outputOfJob: id, jobId: id, agent: "legacy-analyst@1.1.0", actor: "alice", message: "Assess demo: inventory, item catalog and assessment" },
    });
    expect(run?.documentWriteId).toBe(writes[0]?.request.writeId);

    // The checkout, inputs, scratch, the intermediate outputs and the steps' workspaces are gone; out/ stays for the writer.
    const left = await readdir(storage.job(id).root);
    expect(left).toEqual(["out"]);
    for (const child of store.children(id)) expect(existsSync(storage.job(child.id).root)).toBe(false);
  });

  const BAD_TOPOLOGY = { "applications/demo/assessment/topology.json": "{}" };
  const GOOD_TOPOLOGY = JSON.stringify({
    system: "demo",
    root: { id: "root", name: "root", kind: "group", children: [] },
    edges: [],
    entryPoints: [],
    deadEnds: [],
    observations: [],
    flows: [],
  });

  it("masks a credential an agent left in its files instead of failing the run", async () => {
    const { store, runner, writes, agents } = setup({
      "legacy-analyst": (spec): Record<string, string> => (synthesis(spec) ? { "applications/demo/assessment/ASSESSMENT.md": "Config: password = hunter2hunter2\n" } : {}),
    });
    const id = await assess(store);
    const run = await runner.run(id);
    expect(run?.status).toBe("succeeded");
    expect(agents.specs.filter(synthesis)).toHaveLength(1);
    expect(writes).toHaveLength(1);
    const text = readFileSync(join(storage.job(id).out, "applications", "demo", "assessment", "ASSESSMENT.md"), "utf8");
    expect(text).toBe("Config: password = hu****\n");
    // What was masked is logged by rule, file and line; never the value.
    const logged = store.events.map((event) => event.message).filter((message) => message.startsWith("masked "));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^masked 1 credential-shaped value in 1 file of legacy-analyst: credential_assignment at applications\/demo\/assessment\/ASSESSMENT\.md:1$/);
    expect(JSON.stringify([...store.events, ...store.children(id)])).not.toContain("hunter2");
    expect(store.children(id).at(-2)?.outputSummary?.["maskedCredentials"]).toBe(1);
  });

  it("still fails closed for what is not a credential: a malformed artifact, with a redacted reason and no write", async () => {
    const { store, runner, writes } = setup({ "legacy-analyst": (spec): Record<string, string> => (synthesis(spec) ? BAD_TOPOLOGY : {}) });
    const id = await assess(store);
    const run = await runner.run(id);
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toMatch(/^Step synthesis failed: JobOutput hook blocked the output: malformed artifact found — invalid_topology_schema at applications\/demo\/assessment\/topology\.json:1/);
    expect(writes).toHaveLength(0);
    expect(store.children(id).map((child) => child.status)).toEqual([...Array<string>(10).fill("succeeded"), "failed"]);
  });

  it("gives an agent the redacted findings and one retry when the hook flags its files", async () => {
    const { store, runner, writes, agents } = setup({
      "legacy-analyst": (spec): Record<string, string> => {
        if (!synthesis(spec)) return {};
        return spec.task.includes("The output checks rejected the files you wrote") ? { "applications/demo/assessment/topology.json": GOOD_TOPOLOGY } : BAD_TOPOLOGY;
      },
    });
    const id = await assess(store);
    const run = await runner.run(id);
    expect(run?.status).toBe("succeeded");
    expect(writes).toHaveLength(1);
    const attempts = agents.specs.filter(synthesis);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.task).toMatch(/- invalid_topology_schema at applications\/demo\/assessment\/topology\.json:1\n/);
  });

  it("fails after the one retry when the agent keeps the artifact malformed", async () => {
    const { store, runner, writes, agents } = setup({ "legacy-analyst": (spec): Record<string, string> => (synthesis(spec) ? BAD_TOPOLOGY : {}) });
    const id = await assess(store);
    const run = await runner.run(id);
    expect(run?.status).toBe("failed");
    expect(agents.specs.filter(synthesis)).toHaveLength(2);
    expect(writes).toHaveLength(0);
  });

  it("resumes a failed stage: keeps work/, skips the agent jobs that succeeded, reruns the scripts and the failed step", async () => {
    let fail = true;
    const { store, runner, writes } = setup({
      "legacy-analyst": (spec): Record<string, string> => (synthesis(spec) ? (fail ? BAD_TOPOLOGY : { "applications/demo/assessment/ASSESSMENT.md": "# Assessment\n" }) : {}),
    });
    const first = await assess(store);
    expect((await runner.run(first))?.status).toBe("failed");
    // The failed run keeps its steps in the summary, and work/ beside out/.
    const failed = await store.get(first);
    const steps = (failed?.outputSummary?.["steps"] ?? []) as Array<{ id: string; status: string }>;
    expect(steps.map((step) => [step.id, step.status]).at(-1)).toEqual(["synthesis", "failed"]);
    expect(failed?.outputSummary?.["documentsCommit"]).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(storage.job(first).root, "work", "applications", "demo", "assessment", "analysis"))).toBe(true);

    fail = false;
    const second = randomUUID();
    await store.create({ id: second, projectId: "demo", applicationId: "demo", kind: "stage", name: "assess", sourceRepositoryId: "legacy", sourceCommit: failed!.sourceCommit!, actor: "alice", inputs: { resumeOf: first } });
    const resumed = await runner.run(second);
    expect(resumed?.failureReason).toBeUndefined();
    expect(resumed?.status).toBe("succeeded");
    // Only the scripts and the synthesis ran again.
    expect(store.children(second).map((child) => [child.kind, child.inputs["label"] ?? child.name])).toEqual([
      ["script", "inventory.py"],
      ["script", "extract_topology.py"],
      ["script", "catalog_from_topology.py"],
      ["script", "apply_catalog_edits.py"],
      ["script", "reconcile_catalog.py"],
      ["agent", "synthesis"],
      ["script", "style_architecture.py"],
    ]);
    const summary = resumed?.outputSummary as { resumeOf: string; steps: Array<{ id: string; reused?: boolean }> };
    expect(summary.resumeOf).toBe(first);
    expect(summary.steps.filter((step) => step.reused === true).map((step) => step.id).sort()).toEqual(["catalog-curate", "debt", "security", "structure", "topology"]);
    const out = storage.job(second).out;
    expect(existsSync(join(out, "applications", "demo", "assessment", "tools", "extract_topology.py"))).toBe(true);
    expect(readFileSync(join(out, "applications", "demo", "assessment", "ASSESSMENT.md"), "utf8")).toBe("# Assessment\n");
    expect(writes).toHaveLength(1);
  }, 120_000);

  it("fails clearly when an agent has no model binding on the pi runtime", async () => {
    const { store, writes } = setup({});
    const runner = new JobRunner({
      store,
      gates: DEFAULT_GATE_DECIDER,
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

  it("refuses to run a queued review when its pinned agent version no longer matches", async () => {
    const { store, runner, agents, writes } = setup({ "legacy-analyst": () => ({ "review-report.json": "{}" }) });
    const id = randomUUID();
    await store.create({
      id,
      projectId: "demo",
      kind: "agent",
      name: "legacy-analyst",
      inputs: { task: "Review the pinned change.", expectedAgentVersion: "9.9.9" },
    });

    const run = await runner.run(id);

    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toContain("expected agent version 9.9.9");
    expect(agents.specs).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it("keeps review output out of the document-repo publication queue", async () => {
    const { store, runner, writes } = setup({ "legacy-analyst": () => ({ "review-report.json": "{}" }) });
    const id = randomUUID();
    await store.create({
      id,
      projectId: "demo",
      kind: "agent",
      name: "legacy-analyst",
      inputs: { task: "Review the pinned change.", publishOutput: false },
    });

    const run = await runner.run(id);

    expect(run?.status).toBe("succeeded");
    expect(writes).toHaveLength(0);
    expect(store.writes).toHaveLength(0);
  });

  it("does not replay a stalled review agent when the generic job disables stalled retries", async () => {
    const store = new MemoryJobStore();
    let starts = 0;
    const stalled = {
      engine: "mock-review",
      async startJob() {
        starts += 1;
        return {
          jobId: `stalled-${starts}`,
          events: { async *[Symbol.asyncIterator]() { /* no progress events */ } },
          abort: async () => undefined,
          done: Promise.resolve({
            type: "job.failed" as const,
            jobId: `stalled-${starts}`,
            at: new Date().toISOString(),
            reason: "timeout" as const,
            error: "stalled after no provider response",
          }),
        };
      },
    };
    const runner = new JobRunner({
      store,
      gates: DEFAULT_GATE_DECIDER,
      storage,
      checkouts: new LocalCheckouts({ legacy: legacy.bare, docs: docs.bare }),
      agents: stalled,
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      requestWrite: async () => undefined,
      log: () => undefined,
    });
    const id = randomUUID();
    await store.create({
      id,
      projectId: "demo",
      kind: "agent",
      name: "legacy-analyst",
      inputs: { task: "Review the pinned change.", disableStalledRetry: true },
    });

    const run = await runner.run(id);

    expect(run?.status).toBe("failed");
    expect(starts).toBe(1);
  });

  describe("an agent that misplaces an expected file", () => {
    const EXPECTED = "applications/demo/assessment/ASSESSMENT.md";
    const agentRun = async (files: AgentFiles) => {
      const { store, agents } = setup(files);
      const runner = new JobRunner({
        store,
        gates: DEFAULT_GATE_DECIDER,
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
      const { id, run, agents, logs } = await agentRun({ "legacy-analyst": () => ({ "ASSESSMENT.md": "# Assessment\n" }) });
      expect(run?.status).toBe("succeeded");
      expect(agents.specs).toHaveLength(1);
      expect(logs.some((line) => line.includes("moved into place"))).toBe(true);
      expect(readFileSync(join(storage.job(id).out, ...EXPECTED.split("/")), "utf8")).toBe("# Assessment\n");
      expect(existsSync(join(storage.job(id).out, "ASSESSMENT.md"))).toBe(false);
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
    const scriptRepo = fixtureRepository({ "applications/demo/assessment/extract_topology.py": "import json, os, sys\nos.makedirs(sys.argv[1], exist_ok=True)\njson.dump({'ok': True}, open(os.path.join(sys.argv[1], 'nodes.json'), 'w'))\n" });
    try {
      const runnerWithDocs = new JobRunner({
        store,
        gates: DEFAULT_GATE_DECIDER,
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
        inputs: { documents: ["applications/{app}/assessment/extract_topology.py"], scriptFromInputs: "applications/demo/assessment/extract_topology.py", args: ["{out}/applications/{app}/assessment/scratch"] },
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

  it("records the run's live events: status, steps and agent tool calls, without file content", async () => {
    const { store, runner } = setup({ "legacy-analyst": (spec): Record<string, string> => (synthesis(spec) ? { "applications/demo/assessment/ASSESSMENT.md": "# Draft with private detail\n" } : {}) });
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
      gates: DEFAULT_GATE_DECIDER,
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
