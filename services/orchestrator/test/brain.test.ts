// The Brain index (ADR-0091) against a real git remote and a throwaway database: a build of the chosen branch,
// a rebuild when it moves, a failure recorded on the index, and when a build is due.

import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRAIN_BUILDER_VERSION, type BrainSource } from "@kintsugi/domain";
import { CheckoutStorage } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgBrainStore, brainBuildDue, dueBrainBuilds, indexBrain } from "../src/brain/index.js";
import { RepositoryStore } from "../src/git-sync/repositories.js";
import { syncRepository } from "../src/git-sync/sync.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

const SPEC = "# Calculate tax\n\nHow the batch computes the tax — thuế giá trị gia tăng.\n\n## Business rules\n\n### RULE-INV01-0001: Late fee\n\n- **priority:** P0\n";

describe.skipIf(!hasDatabase)("brain index (integration)", () => {
  let db: TestDatabase;
  let remote: GitHttpServer;
  let dataDir: string;
  let deps: Parameters<typeof indexBrain>[0];
  let store: PgBrainStore;

  beforeAll(async () => {
    process.env["KINTSUGI_SECRET_KEY"] ??= randomBytes(32).toString("base64");
    db = await createTestDatabase();
    remote = await startGitHttpServer();
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-brain-"));
    const storage = new CheckoutStorage(dataDir);
    await storage.prepare();
    const repositories = new RepositoryStore(db.pool);
    deps = { pool: db.pool, repositories, storage, log: () => undefined };
    store = new PgBrainStore(db.pool);
    await remote.createRepository("shop-docs");
    await remote.commitFiles("shop-docs", [
      { path: "01-standards/README.md", content: "# Standards\n\nHow this project writes code.\n" },
      { path: "10-applications/billing/01-legacy/invoice/tax/spec.md", content: SPEC },
      { path: "10-applications/billing/01-legacy/invoice/tax/data-objects.md", content: "## Invoice line\n\nSee RULE-INV01-0001.\n" },
      { path: "plugins/demo/README.md", content: "# Not knowledge\n" },
    ]);
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('internal', 'plain-git', 'Internal', $1, 'none')", [remote.baseUrl]);
    await db.pool.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('shop-docs', 'internal', $1, 'main')", [`${remote.baseUrl}/shop-docs.git`]);
    await db.pool.query("insert into admin.project (id, name) values ('shop', 'Shop')");
    await db.pool.query("insert into admin.project_repository (project_id, repository_id, role) values ('shop', 'shop-docs', 'document')");
    await syncRepository({ store: repositories, storage }, "shop-docs");
  });
  afterAll(async () => {
    await remote?.close();
    await db?.drop();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  });

  it("builds the tree of the chosen branch, with summaries, cards and links", async () => {
    await store.configure("shop", { branch: "main", enabled: true }, "alice");
    const outcome = await indexBrain(deps, "shop");
    // The remote's first commit has a README at the root.
    expect(outcome).toMatchObject({ status: "built", documents: 4 });

    const source = await store.source("shop");
    expect(source).toMatchObject({ state: "ready", documents: 4, identifiers: 1, builderVersion: BRAIN_BUILDER_VERSION, error: null });
    const root = await store.children("shop", "/", 0, 10);
    expect(root.items.map((node) => node.id)).toEqual(["01-standards/", "10-applications/", "README.md"]);
    expect(root.items[0]).toMatchObject({ summarySource: "readme", summary: "How this project writes code." });

    const spec = await store.node("shop", "10-applications/billing/01-legacy/invoice/tax/spec.md");
    expect(spec?.summary).toBe("How the batch computes the tax — thuế giá trị gia tăng.");
    const [card] = await store.lookup("shop", "RULE-INV01-0001", 5);
    expect(card).toMatchObject({ kind: "card", lineStart: 7, summary: "priority: P0" });
    const links = await store.links("shop", card!.id, 10);
    expect(links.incoming.map((node) => node.id)).toEqual(["10-applications/billing/01-legacy/invoice/tax/data-objects.md#invoice-line"]);
    expect(await store.ancestors("shop", card!.id)).toHaveLength(8);
    const [hit] = await store.nodesAtLines("shop", [{ path: "10-applications/billing/01-legacy/invoice/tax/spec.md", line: 9 }]);
    expect(hit?.id).toBe(card!.id);
  });

  it("is due again when its branch moves, and rebuilds from the new tip", async () => {
    const before = (await store.source("shop"))!;
    expect(await dueBrainBuilds(deps)).toEqual([]);
    const next = await remote.commit("shop-docs", "00-project/charter.md", "# Charter\n\nWhy we migrate.\n");
    await syncRepository({ store: deps.repositories, storage: deps.storage }, "shop-docs");
    expect(await dueBrainBuilds(deps)).toEqual(["shop"]);
    await indexBrain(deps, "shop");
    const after = (await store.source("shop"))!;
    expect(after.indexedCommit).toBe(next);
    expect(after.indexedCommit).not.toBe(before.indexedCommit);
    expect(after.documents).toBe(5);
  });

  it("records a failure on the index and does not try the same commit again", async () => {
    await store.configure("shop", { branch: "release", enabled: true }, "alice");
    const outcome = await indexBrain(deps, "shop");
    expect(outcome).toMatchObject({ status: "failed" });
    expect(await store.source("shop")).toMatchObject({ state: "failed", error: expect.stringMatching(/Branch release is not in the mirror/) });
    expect(await dueBrainBuilds(deps)).toEqual([]);
    // The tree of the last good build stays readable.
    expect((await store.children("shop", "/", 0, 10)).total).toBe(4);
  });

  it("skips a project whose Brain is off", async () => {
    await store.configure("shop", { branch: "main", enabled: false }, "alice");
    expect(await indexBrain(deps, "shop")).toMatchObject({ status: "skipped" });
  });
});

describe("brainBuildDue", () => {
  const source = (overrides: Partial<BrainSource>): BrainSource => ({
    projectId: "shop",
    branch: "main",
    enabled: true,
    state: "ready",
    indexedCommit: "a".repeat(40),
    attemptedCommit: "a".repeat(40),
    indexedAt: "2026-10-31T00:00:00.000Z",
    builderVersion: BRAIN_BUILDER_VERSION,
    documents: 1,
    nodes: 2,
    identifiers: 0,
    links: 0,
    tokens: 10,
    skipped: 0,
    durationMs: 5,
    error: null,
    requestedAt: "2026-10-31T00:00:00.000Z",
    startedAt: "2026-10-31T00:00:00.000Z",
    updatedBy: "alice",
    updatedAt: "2026-10-31T00:00:00.000Z",
    ...overrides,
  });
  const now = Date.parse("2026-10-31T00:10:00.000Z");

  it("follows the branch tip and the builder version", () => {
    expect(brainBuildDue(source({}), "a".repeat(40), now)).toBe(false);
    expect(brainBuildDue(source({}), "b".repeat(40), now)).toBe(true);
    expect(brainBuildDue(source({ builderVersion: BRAIN_BUILDER_VERSION - 1 }), "a".repeat(40), now)).toBe(true);
  });

  it("does not retry a commit a build failed on, nor a build in progress", () => {
    expect(brainBuildDue(source({ state: "failed", attemptedCommit: "b".repeat(40) }), "b".repeat(40), now)).toBe(false);
    expect(brainBuildDue(source({ state: "failed", attemptedCommit: "b".repeat(40) }), "c".repeat(40), now)).toBe(true);
    expect(brainBuildDue(source({ state: "indexing" }), "b".repeat(40), now)).toBe(false);
    expect(brainBuildDue(source({ state: "indexing", startedAt: "2026-10-30T00:00:00.000Z" }), "b".repeat(40), now)).toBe(true);
  });
});
