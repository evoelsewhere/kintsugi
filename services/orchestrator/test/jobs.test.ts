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
import { interpretersFromEnv } from "@kintsugi/runtime/launcher";
import type { JobSpec } from "@kintsugi/runtime-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";
import { JobRunner } from "../src/jobs/runner.js";
import type { DocumentWriteRequest } from "../src/queues.js";
import { type AgentFiles, LocalCheckouts, MemoryJobStore, fixtureRepository, writingAgentRuntime } from "./support/jobs.js";

const LEGACY_FILES = {
  "src/main.c": "int main(void) {\n  if (1) { return 0; }\n  return 1;\n}\n",
  "src/util.c": "int add(int a, int b) { for (;;) { return a + b; } }\n",
  "README.md": "# Demo\n",
};
const DOCUMENT_FILES = {
  "kintsugi.yaml": "version: 1\nproject: { id: demo }\n",
  "assessment/demo/INTENT.md": "Move to a supported platform.\n",
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

  it("runs the assess stage: inventory script, legacy-analyst job, hook, restricted record, document write", async () => {
    const seen: { inventory?: { sourceFileCount: number }; intent?: string; srcWritable?: boolean } = {};
    const { store, runner, writes, agents } = setup({
      "legacy-analyst": (spec: JobSpec) => {
        const [src, inputs] = spec.workspace.readOnly as [string, string];
        seen.inventory = JSON.parse(readFileSync(join(inputs, "assessment", "demo", "inventory.json"), "utf8")) as { sourceFileCount: number };
        seen.intent = readFileSync(join(inputs, "assessment", "demo", "INTENT.md"), "utf8");
        try {
          writeFileSync(join(src, "src", "main.c"), "tampered");
          seen.srcWritable = true;
        } catch {
          seen.srcWritable = false;
        }
        return {
          "assessment/demo/ASSESSMENT.md": `# Assessment (draft)\n\n${seen.inventory.sourceFileCount} source files.\n`,
          "restricted/SECRETS.local.md": "| preview | location |\n|---|---|\n| hu** | src/main.c:2 |\n",
        };
      },
    });
    const id = await assess(store);
    const run = await runner.run(id);

    expect(run).toMatchObject({ status: "succeeded", kind: "stage", name: "assess" });
    expect(run?.sourceCommit).toMatch(/^[0-9a-f]{40}$/);

    // Steps: a script child with its hash, then an agent child with its version.
    const [script, agent] = store.children(id);
    expect(script).toMatchObject({ kind: "script", name: "inventory.py", status: "succeeded", sourceCommit: run?.sourceCommit });
    expect(script?.scriptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(agent).toMatchObject({ kind: "agent", name: "legacy-analyst", status: "succeeded", agent: "legacy-analyst@1.0.0" });

    // The agent read the script's output and the declared document as read-only inputs, and could not change the source.
    expect(seen.inventory?.sourceFileCount).toBe(3);
    expect(seen.intent).toContain("supported platform");
    if (process.platform === "win32" || process.getuid?.() !== 0) expect(seen.srcWritable).toBe(false);
    const spec = agents.specs[0]!;
    expect(spec.model).toEqual({ provider: "mock", id: "mock" });
    expect(spec.task).toContain("assessment/demo/ASSESSMENT.md");
    expect(spec.task).not.toContain("{app}");

    // out/ holds what goes to Git; restricted/ went to the restricted record only.
    const out = storage.job(id).out;
    expect(existsSync(join(out, "assessment", "demo", "inventory.json"))).toBe(true);
    expect(readFileSync(join(out, "assessment", "demo", "ASSESSMENT.md"), "utf8")).toContain("3 source files");
    expect(existsSync(join(out, "restricted"))).toBe(false);
    expect(store.restricted.get(agent!.id)?.get("SECRETS.local.md")).toContain("hu**");
    expect(JSON.stringify(run?.outputSummary)).not.toContain("SECRETS");

    // Artifact index with provenance per producer.
    const artifacts = store.artifacts.get(id) ?? [];
    expect(artifacts.map((entry) => entry.path).sort()).toEqual(["assessment/demo/ASSESSMENT.md", "assessment/demo/inventory.json"]);
    expect(artifacts.find((entry) => entry.path.endsWith("inventory.json"))?.provenance).toMatchObject({ origin: "tool" });
    expect(artifacts.find((entry) => entry.path.endsWith("ASSESSMENT.md"))?.provenance).toMatchObject({ origin: "runtime-agent", runtimeAgent: "legacy-analyst", model: "mock/mock" });

    // Handed to the writer: the stage's out/, with job, agent and actor provenance.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      repository: "docs",
      request: { projectId: "demo", kind: "job-output", outputOfJob: id, jobId: id, agent: "legacy-analyst@1.0.0", actor: "alice", message: "Assess demo: inventory and assessment draft" },
    });
    expect(run?.documentWriteId).toBe(writes[0]?.request.writeId);

    // The checkout, inputs, scratch and the steps' workspaces are gone; out/ stays for the writer.
    const left = await readdir(storage.job(id).root);
    expect(left).toEqual(["out"]);
    for (const child of store.children(id)) expect(existsSync(storage.job(child.id).root)).toBe(false);
  });

  it("fails the stage when the JobOutput hook finds a credential, with a redacted reason and no write", async () => {
    const { store, runner, writes } = setup({
      "legacy-analyst": () => ({ "assessment/demo/ASSESSMENT.md": "Config: password = hunter2hunter2\n" }),
    });
    const id = await assess(store);
    const run = await runner.run(id);
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toMatch(/^Step legacy-analyst failed: JobOutput hook blocked the output: credential-shaped values found — .* at assessment\/demo\/ASSESSMENT\.md:1/);
    expect(run?.failureReason).not.toContain("hunter2");
    expect(writes).toHaveLength(0);
    expect(store.children(id).map((child) => child.status)).toEqual(["succeeded", "failed"]);
  });

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
    expect(run?.failureReason).toBe('Step legacy-analyst failed: No model is bound to agent "legacy-analyst" (Settings → LLM Providers)');
    expect(writes).toHaveLength(0);
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
    const scriptRepo = fixtureRepository({ "assessment/demo/extract_topology.py": "import json, os, sys\nos.makedirs(sys.argv[1], exist_ok=True)\njson.dump({'ok': True}, open(os.path.join(sys.argv[1], 'nodes.json'), 'w'))\n" });
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
        inputs: { documents: ["assessment/{app}/extract_topology.py"], scriptFromInputs: "assessment/demo/extract_topology.py", args: ["{out}/assessment/{app}/scratch"] },
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
});
