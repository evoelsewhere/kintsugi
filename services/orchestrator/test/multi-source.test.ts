// An application with several legacy repositories (ADR-0052): a run mounts every one of them, each
// at its own commit, in its own folder under src/, and the stage reads them as one tree whose first
// folder is the repository. Before, a run took the first repository and the others were never read.

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { documentOf, parseItemCatalog } from "@kintsugi/agents/reader";
import { CheckoutStorage } from "@kintsugi/git";
import { interpretersFromEnv } from "@kintsugi/runtime/launcher";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";
import { JobRunner } from "../src/jobs/runner.js";
import type { DocumentWriteRequest } from "../src/queues.js";
import { LocalCheckouts, MemoryJobStore, fixtureRepository, writingAgentRuntime } from "./support/jobs.js";

const SKELETON = { "src/main.c": "int main(void) {\n  if (1) { return 0; }\n  return 1;\n}\n", "README.md": "# Skeleton\n" };
const UNITIES = { "lib/util.c": "int add(int a, int b) { for (;;) { return a + b; } }\n" };
const DOCUMENTS = { "kintsugi.yaml": "version: 1\nproject: { id: demo }\n" };

describe("an application with two legacy repositories", () => {
  const repos: Record<string, ReturnType<typeof fixtureRepository>> = {};
  let dataDir: string;
  let storage: CheckoutStorage;

  beforeAll(async () => {
    repos["falo-skeleton"] = fixtureRepository(SKELETON);
    repos["falo-unities"] = fixtureRepository(UNITIES);
    repos["docs"] = fixtureRepository(DOCUMENTS);
    dataDir = mkdtempSync(join(tmpdir(), "kintsugi-multi-source-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
  });
  afterAll(async () => {
    for (const repo of Object.values(repos)) await repo.remove();
    await rm(dataDir, { recursive: true, force: true });
  });

  function setup(files: Parameters<typeof writingAgentRuntime>[0] = {}) {
    const store = new MemoryJobStore();
    const writes: DocumentWriteRequest[] = [];
    const agents = writingAgentRuntime(files);
    const checkouts = new LocalCheckouts(Object.fromEntries(Object.entries(repos).map(([id, repo]) => [id, repo.bare])));
    const runner = new JobRunner({
      store,
      storage,
      checkouts,
      agents,
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      requestWrite: async (_repository, request) => {
        writes.push(request);
      },
      log: () => undefined,
    });
    return { store, runner, writes, agents, checkouts };
  }

  const SOURCES = [{ repositoryId: "falo-skeleton" }, { repositoryId: "falo-unities" }];

  it("mounts every repository in its own folder under src/, each at its own commit, and removes them all", async () => {
    const seen: { folders?: string[]; files?: string[] } = {};
    const { store, runner, checkouts } = setup({
      "legacy-analyst": (spec) => {
        const [src] = spec.workspace.readOnly as [string];
        seen.folders = readdirSync(src).sort();
        seen.files = [join("falo-skeleton", "src", "main.c"), join("falo-unities", "lib", "util.c")].filter((file) => existsSync(join(src, file)));
        return { "notes.md": "# notes\n" };
      },
    });
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "agent", name: "legacy-analyst", sourceRepositoryId: "falo-skeleton", sources: SOURCES, inputs: { task: "Read it.", expects: ["notes.md"] } });
    const run = await runner.run(id);
    expect(run?.failureReason).toBeUndefined();
    expect(run?.status).toBe("succeeded");

    expect(seen.folders).toEqual(["falo-skeleton", "falo-unities"]);
    expect(seen.files).toHaveLength(2);

    // The run recorded both commits, in order; the first one is also the run's source commit.
    const first = await checkouts.resolve("falo-skeleton");
    const second = await checkouts.resolve("falo-unities");
    expect(run?.sources).toEqual([
      { repositoryId: "falo-skeleton", commit: first },
      { repositoryId: "falo-unities", commit: second },
    ]);
    expect(run?.sourceCommit).toBe(first);

    // Nothing of the checkouts is left behind.
    expect(existsSync(storage.job(id).src)).toBe(false);
  });

  it("a run pinned at commits reads exactly those, and a one-repository run still mounts its repository in its folder", async () => {
    const { store, runner, checkouts } = setup();
    const first = await checkouts.resolve("falo-skeleton");
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "agent", name: "legacy-analyst", sourceRepositoryId: "falo-skeleton", sources: [{ repositoryId: "falo-skeleton", commit: first }], inputs: { task: "Read it.", expects: [] } });
    const run = await runner.run(id);
    expect(run?.status).toBe("succeeded");
    expect(run?.sources).toEqual([{ repositoryId: "falo-skeleton", commit: first }]);

    // A run recorded before the list existed names one repository and one commit: the same single folder.
    const old = randomUUID();
    const seen: { folders?: string[] } = {};
    const old$ = setup({ "legacy-analyst": (spec) => ((seen.folders = readdirSync((spec.workspace.readOnly as [string])[0]).sort()), {}) });
    await old$.store.create({ id: old, projectId: "demo", applicationId: "demo", kind: "agent", name: "legacy-analyst", sourceRepositoryId: "falo-skeleton", sourceCommit: first, inputs: { task: "Read it.", expects: [] } });
    expect((await old$.runner.run(old))?.status).toBe("succeeded");
    expect(seen.folders).toEqual(["falo-skeleton"]);
  });

  it("assesses both repositories as one tree: the inventory, the catalog and the prompts name each repository", async () => {
    const { store, runner, agents, writes, checkouts } = setup();
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "stage", name: "assess", sourceRepositoryId: "falo-skeleton", sources: SOURCES, actor: "alice" });
    const run = await runner.run(id);
    expect(run?.failureReason).toBeUndefined();
    expect(run?.status).toBe("succeeded");

    const first = await checkouts.resolve("falo-skeleton");
    const second = await checkouts.resolve("falo-unities");
    const out = join(storage.job(id).out, "10-applications", "demo", "01-legacy");

    // Both repositories were measured, each named with its commit; the files are cited under their repository.
    const inventory = documentOf(readFileSync(join(out, "inventory.md"), "utf8")).data;
    expect(inventory["sources"]).toEqual([`falo-skeleton@${first}`, `falo-unities@${second}`]);
    expect(inventory["sourceFileCount"]).toBe(3);

    // The catalog covers the files of both: the mock topology makes one module per top folder, that is per repository.
    const catalog = parseItemCatalog(readFileSync(join(out, "_catalog", "index.md"), "utf8"), {
      "falo-skeleton": readFileSync(join(out, "_catalog", "falo-skeleton.md"), "utf8"),
      "falo-unities": readFileSync(join(out, "_catalog", "falo-unities.md"), "utf8"),
    })!;
    expect(catalog.source.sources).toEqual([`falo-skeleton@${first}`, `falo-unities@${second}`]);
    expect(catalog.items.flatMap((item) => item.files).sort()).toEqual(["falo-skeleton/src/main.c", "falo-unities/lib/util.c"]);
    expect(catalog.unassigned).toEqual(["falo-skeleton/README.md"]);

    // The agents are told where the repositories are and which commits are pinned; no placeholder is left.
    const task = agents.specs.find((spec) => spec.task.startsWith("Build the structural map"))!.task;
    expect(task).toContain(`falo-skeleton@${first},falo-unities@${second}`);
    expect(task).toContain("one folder per legacy repository");
    expect(task).not.toMatch(/\{(sources|src|repo|commit)\}/);
    expect(writes).toHaveLength(1);
  }, 120_000);

  it("fails with a clear reason when a repository of the application is gone", async () => {
    const { store, runner } = setup();
    const id = randomUUID();
    await store.create({ id, projectId: "demo", applicationId: "demo", kind: "agent", name: "legacy-analyst", sourceRepositoryId: "falo-skeleton", sources: [...SOURCES, { repositoryId: "falo-removed" }], inputs: { task: "Read it.", expects: [] } });
    const run = await runner.run(id);
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toMatch(/falo-removed/);
    // The repositories that did mount are released.
    expect(existsSync(storage.job(id).src)).toBe(false);
  });
});
