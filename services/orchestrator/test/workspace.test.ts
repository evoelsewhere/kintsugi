// The job workspace (ADR-0055): the repositories mounted by role, the guide, relative paths, the checkouts kept
// across the attempts of a failed job and dropped when they expire, and what a retried step is told.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { DEFAULT_SANDBOX, type SandboxSettings } from "@kintsugi/domain";
import { CheckoutStorage } from "@kintsugi/git";
import { interpretersFromEnv } from "@kintsugi/runtime/launcher";
import type { JobSpec } from "@kintsugi/runtime-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";
import { type WorkspaceState, dropExpiredCheckouts } from "../src/jobs/cleanup.js";
import { JobRunner } from "../src/jobs/runner.js";
import { readManifest } from "../src/workspace/manifest.js";
import { renderGuide } from "../src/workspace/guide.js";
import { type AgentFiles, LocalCheckouts, MemoryJobStore, fixtureRepository, writingAgentRuntime } from "./support/jobs.js";

const HOUR = 60 * 60 * 1000;
const COMMIT = "a".repeat(40);

describe("the guide", () => {
  it("names the repositories by zone, how to cite, what earlier attempts left and what was read", () => {
    const text = renderGuide({
      jobId: "job-1",
      attempt: 2,
      job: "stage understand",
      applicationId: "web",
      sources: [
        { repositoryId: "skeleton", commit: COMMIT, role: "legacy", path: "as-is/skeleton", files: 1234 },
        { repositoryId: "unities", commit: "b".repeat(40), role: "legacy", path: "as-is/unities" },
        { repositoryId: "api", commit: "c".repeat(40), role: "target", path: "to-be/api" },
      ],
      documentsCommit: "d".repeat(40),
      history: { succeeded: 3, failed: [{ key: "synthesis", reason: "boom" }] },
    });
    expect(text).toContain("Job `job-1`, attempt 2: stage understand of the application `web`.");
    expect(text).toContain("| as-is | skeleton | `aaaaaaaaaaaa` | 1234 |");
    expect(text).toContain("| to-be | api | `cccccccccccc` |");
    expect(text).toContain("Cite a file as `<repository>/<path in the repository>`, never with the zone folder: `skeleton/<path>`. You read it at `as-is/skeleton/<path>`.");
    expect(text).toContain("The application has 2 legacy repositories. Read all of them");
    expect(text).toContain("3 steps of the earlier attempts succeeded and are not run again.");
    expect(text).toContain("- `synthesis`: boom");
    expect(text).not.toMatch(/\n\n\n/);
  });

  it("leaves out what a first attempt of a job without repositories has nothing to say about", () => {
    const text = renderGuide({ jobId: "job-2", attempt: 1, job: "agent writer", sources: [] });
    expect(text).not.toContain("## Repositories");
    expect(text).not.toContain("## Earlier attempts");
    expect(text).toContain("## Working rules");
  });
});

describe("a job workspace across attempts", () => {
  let legacy: ReturnType<typeof fixtureRepository>;
  let target: ReturnType<typeof fixtureRepository>;
  let docs: ReturnType<typeof fixtureRepository>;
  let dataDir: string;
  let storage: CheckoutStorage;

  beforeAll(async () => {
    legacy = fixtureRepository({ "src/main.c": "int main(void) { return 0; }\n" });
    target = fixtureRepository({ "src/index.ts": "export const main = (): number => 0;\n" });
    docs = fixtureRepository({ "kintsugi.yaml": "version: 1\nproject: { id: demo }\n", "10-applications/demo/00-inputs/INTENT.md": "Move.\n" });
    dataDir = mkdtempSync(join(tmpdir(), "kintsugi-workspace-data-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
  });
  afterAll(async () => {
    await legacy?.remove();
    await target?.remove();
    await docs?.remove();
    await rm(dataDir, { recursive: true, force: true });
  });

  function setup(files: AgentFiles, mockOutputs?: boolean) {
    const store = new MemoryJobStore();
    const agents = writingAgentRuntime(files);
    const checkouts = new LocalCheckouts({ legacy: legacy.bare, "target-api": target.bare, docs: docs.bare });
    const runner = new JobRunner({
      store,
      storage,
      checkouts,
      agents,
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      ...(mockOutputs === undefined ? {} : { mockOutputs }),
      requestWrite: async () => undefined,
      log: () => undefined,
    });
    return { store, runner, agents, checkouts };
  }

  const agentJob = async (store: MemoryJobStore, inputs: Record<string, unknown>): Promise<string> => {
    const id = randomUUID();
    await store.create({
      id,
      projectId: "demo",
      applicationId: "demo",
      kind: "agent",
      name: "legacy-analyst",
      sourceRepositoryId: "legacy",
      sources: [{ repositoryId: "legacy", role: "legacy" }, { repositoryId: "target-api", role: "target" }],
      inputs,
    });
    return id;
  };

  const relativeToRoot = (id: string, path: string): string => relative(storage.job(id).root, path).split(sep).join("/");

  it("mounts the as-is and the to-be read-only in their zones, with relative paths and the guide, and drops them when the job ends well", async () => {
    const { store, runner, agents } = setup({ "legacy-analyst": () => ({ "notes.md": "# Notes\n" }) }, false);
    const id = await agentJob(store, { task: "Read {src} and {tobe}; the inputs are {in}, write to {out}; sources {sources}.", documents: ["kintsugi.yaml"] });
    const seen: { guide?: string; toBe?: string; asIs?: string } = {};
    const original = agents.startJob.bind(agents);
    agents.startJob = async (spec) => {
      const paths = storage.job(id);
      seen.guide = readFileSync(paths.guide, "utf8");
      seen.asIs = readFileSync(join(paths.asIs, "legacy", "src", "main.c"), "utf8");
      seen.toBe = readFileSync(join(paths.toBe, "target-api", "src", "index.ts"), "utf8");
      return original(spec);
    };
    const run = await runner.run(id);
    expect(run?.status).toBe("succeeded");

    const spec = agents.specs[0]!;
    const paths = storage.job(id);
    expect(spec.workspace.root).toBe(paths.root);
    expect(spec.workspace.readOnly.map((path) => relativeToRoot(id, path))).toEqual(["as-is", "to-be", "docs", "WORKSPACE.md"]);
    expect(relativeToRoot(id, spec.workspace.outDir)).toBe("out");
    expect(spec.task).toBe(`Read as-is and to-be; the inputs are docs, write to out; sources legacy@${run!.sourceCommit}.`);

    expect(seen.asIs).toContain("int main");
    expect(seen.toBe).toContain("export const main");
    expect(seen.guide).toContain("| as-is | legacy |");
    expect(seen.guide).toContain("| to-be | target-api |");
    expect(seen.guide).toContain(`Job \`${id}\`, attempt 1: agent legacy-analyst of the application \`demo\`.`);
    expect(run?.sources).toEqual([
      { repositoryId: "legacy", commit: expect.stringMatching(/^[0-9a-f]{40}$/), role: "legacy" },
      { repositoryId: "target-api", commit: expect.stringMatching(/^[0-9a-f]{40}$/), role: "target" },
    ]);

    // The attempt ended well: the checkouts, the inputs and the scratch are gone; the results, the guide and the manifest stay.
    expect(existsSync(paths.asIs)).toBe(false);
    expect(existsSync(paths.toBe)).toBe(false);
    expect(existsSync(paths.docs)).toBe(false);
    expect(readFileSync(join(paths.out, "notes.md"), "utf8")).toBe("# Notes\n");
    expect(await readManifest(paths.manifest)).toMatchObject({ jobId: id, attempt: 1, state: "published", checkoutsDroppedAt: expect.any(String) });
  });

  it("keeps the checkouts of a job that failed, drops them when they expire, and makes them again for the next attempt", async () => {
    const { store, runner, checkouts } = setup({ "legacy-analyst": () => ({}) }, false);
    const id = await agentJob(store, { task: "Write the notes.", expects: ["notes.md"] });
    expect((await runner.run(id))?.status).toBe("failed");
    const paths = storage.job(id);
    expect(existsSync(join(paths.asIs, "legacy", "src", "main.c"))).toBe(true);
    expect(existsSync(join(paths.toBe, "target-api", "src", "index.ts"))).toBe(true);
    expect(await readManifest(paths.manifest)).toMatchObject({ state: "parked", attempt: 1 });
    expect(checkouts.checkouts.map((checkout) => checkout.id)).toEqual(["legacy", "target-api"]);

    // Within the hours the checkouts are kept; after them the sweep drops them (and only them).
    const states = new Map<string, WorkspaceState>([[id, { status: "failed", finishedAt: new Date(Date.now() - 2 * HOUR) }]]);
    const options = { storage, store: { workspaceStates: async () => states }, checkouts };
    expect(await dropExpiredCheckouts({ ...options, checkoutMs: 24 * HOUR })).toEqual([]);
    expect(existsSync(paths.asIs)).toBe(true);
    expect(await dropExpiredCheckouts({ ...options, checkoutMs: HOUR })).toEqual([id]);
    expect(existsSync(paths.asIs)).toBe(false);
    expect(existsSync(paths.toBe)).toBe(false);
    expect(await dropExpiredCheckouts({ ...options, checkoutMs: HOUR })).toEqual([]);
    expect((await readManifest(paths.manifest))?.checkoutsDroppedAt).toEqual(expect.any(String));
    expect(existsSync(paths.out)).toBe(true);

    // The next attempt provisions what was dropped, from the same pins.
    store.requeue(id, { expects: [] });
    const pins = (await readManifest(paths.manifest))!.sources;
    const retried = await runner.run(id);
    expect(retried).toMatchObject({ status: "succeeded", attempt: 2 });
    expect(checkouts.checkouts.map((checkout) => [checkout.id, checkout.commit])).toEqual([
      ["legacy", pins[0]!.commit],
      ["target-api", pins[1]!.commit],
      ["legacy", pins[0]!.commit],
      ["target-api", pins[1]!.commit],
    ]);
  });

  it("keeps a checkout that is still the pinned commit, and mounts it again when someone changed it", async () => {
    const { store, runner, checkouts } = setup({ "legacy-analyst": () => ({}) }, false);
    const id = await agentJob(store, { task: "Write the notes.", expects: ["notes.md"] });
    expect((await runner.run(id))?.status).toBe("failed");
    expect(checkouts.checkouts).toHaveLength(2);
    store.requeue(id);
    expect((await runner.run(id))?.status).toBe("failed");
    // Nothing was checked out again: both folders were still the pinned commit, untouched.
    expect(checkouts.checkouts).toHaveLength(2);

    // A folder that is not what was pinned is replaced, not trusted.
    const stray = join(storage.job(id).asIs, "legacy", "stray.txt");
    mkdirSync(dirname(stray), { recursive: true });
    writeFileSync(stray, "left behind\n");
    store.requeue(id);
    expect((await runner.run(id))?.status).toBe("failed");
    expect(checkouts.checkouts.map((checkout) => checkout.id)).toEqual(["legacy", "target-api", "legacy"]);
    expect(existsSync(stray)).toBe(false);
  });

  it("tells a step that an earlier try left files in its output folder, by name only", async () => {
    const { store, runner, agents } = setup({ "legacy-analyst": () => ({}) });
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "stage", name: "assess", sourceRepositoryId: "legacy", actor: "alice" });
    // What a synthesis step that failed in an earlier attempt left in its folder of the workspace.
    const left = join(storage.job(id).step("synthesis").out, "10-applications", "demo", "01-legacy", "draft.md");
    mkdirSync(dirname(left), { recursive: true });
    writeFileSync(left, "# half of it, with a secret hunter2\n");
    const run = await runner.run(id);
    expect(run?.status).toBe("succeeded");
    const synthesis = agents.specs.find((spec) => spec.task.startsWith("Write the assessment of application"))!;
    expect(synthesis.task).toContain("An earlier try of this step stopped before it finished.");
    expect(synthesis.task).toContain("10-applications/demo/01-legacy/draft.md");
    expect(synthesis.task).not.toContain("hunter2");
    // The other steps had nothing left and are told nothing.
    expect(agents.specs.filter((spec) => spec !== synthesis).every((spec) => !spec.task.includes("An earlier try"))).toBe(true);
    // The step's folder is gone once it succeeded, and the stage's workspace has no steps left.
    expect(existsSync(storage.job(id).steps)).toBe(false);
  });

  it("leaves out a target repository that cannot be read, and fails for a legacy one", async () => {
    const { store, runner, agents } = setup({ "legacy-analyst": () => ({ "notes.md": "# Notes\n" }) }, false);
    const id = randomUUID();
    await store.create({
      id,
      projectId: "demo",
      applicationId: "demo",
      kind: "agent",
      name: "legacy-analyst",
      sourceRepositoryId: "legacy",
      sources: [{ repositoryId: "legacy", role: "legacy" }, { repositoryId: "target-gone", role: "target" }, { repositoryId: "target-api", role: "target" }],
      inputs: { task: "Read {src} and {tobe}." },
    });
    const run = await runner.run(id);
    expect(run?.status).toBe("succeeded");
    expect(run?.sources?.map((source) => source.repositoryId)).toEqual(["legacy", "target-api"]);
    expect(agents.specs[0]!.workspace.readOnly.map((path) => relativeToRoot(id, path))).toEqual(["as-is", "to-be", "docs", "WORKSPACE.md"]);
    expect(store.events.some((event) => event.message.startsWith("to-be repository target-gone is left out"))).toBe(true);

    const broken = randomUUID();
    await store.create({ id: broken, projectId: "demo", applicationId: "demo", kind: "agent", name: "legacy-analyst", sourceRepositoryId: "legacy-gone", sources: [{ repositoryId: "legacy-gone", role: "legacy" }], inputs: { task: "x" } });
    const failed = await runner.run(broken);
    expect(failed?.status).toBe("failed");
    expect(failed?.failureReason).toMatch(/legacy-gone/);
  });
});

describe("the sandbox settings reach the job", () => {
  let legacy: ReturnType<typeof fixtureRepository>;
  let dataDir: string;
  let storage: CheckoutStorage;

  beforeAll(async () => {
    legacy = fixtureRepository({ "src/main.c": "int main(void) { return 0; }\n" });
    dataDir = mkdtempSync(join(tmpdir(), "kintsugi-sandbox-data-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
  });
  afterAll(async () => {
    await legacy?.remove();
    await rm(dataDir, { recursive: true, force: true });
  });

  const runWith = async (settings: Partial<SandboxSettings>, task = "Do it."): Promise<{ spec: JobSpec; mode: number | undefined; id: string; store: MemoryJobStore }> => {
    const store = new MemoryJobStore();
    const agents = writingAgentRuntime({});
    const checkouts = new LocalCheckouts({ legacy: legacy.bare });
    let mode: number | undefined;
    const original = agents.startJob.bind(agents);
    const id = randomUUID();
    agents.startJob = async (spec) => {
      mode = statSync(join(storage.job(id).asIs, "legacy", "src", "main.c")).mode;
      return original(spec);
    };
    const runner = new JobRunner({
      store,
      storage,
      checkouts,
      agents,
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      sandbox: async () => ({ ...DEFAULT_SANDBOX, ...settings }),
      mockOutputs: false,
      requestWrite: async () => undefined,
      log: () => undefined,
    });
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "agent", name: "legacy-analyst", sourceRepositoryId: "legacy", sources: [{ repositoryId: "legacy", role: "legacy" }], inputs: { task } });
    expect((await runner.run(id))?.status).toBe("succeeded");
    return { spec: agents.specs[0]!, mode, id, store };
  };

  it("gives an agent job the timeouts, the turn and cost limits and the idle limit of the settings", async () => {
    const { spec } = await runWith({ agentTimeoutSec: 1800, agentIdleTimeoutSec: 120, maxTurns: 40, maxCostUsd: 3 });
    expect(spec.limits).toEqual({ timeoutSec: 1800, idleTimeoutSec: 120, maxTurns: 40, maxCostUsd: 3 });
    const defaults = (await runWith({})).spec;
    expect(defaults.limits).toEqual({ timeoutSec: 0, idleTimeoutSec: 300 });
  });

  it("marks the checkout read-only unless the settings say not to", async () => {
    const marked = await runWith({ markReadOnly: true });
    const open = await runWith({ markReadOnly: false });
    expect((marked.mode ?? 0) & 0o200).toBe(0);
    expect((open.mode ?? 0) & 0o200).not.toBe(0);
  });
});
