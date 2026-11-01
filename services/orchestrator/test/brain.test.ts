// The Brain index (ADR-0091) against a real git remote and a throwaway database: a build of the chosen branch,
// a rebuild when it moves, a failure recorded on the index, and when a build is due.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRAIN_BUILDER_VERSION, BRAIN_MAX_FILE_BYTES, BRAIN_MAX_LINKS_PER_NODE, type BrainSource, buildBrainTree } from "@kintsugi/domain";
import { CheckoutStorage } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgBrainStore, brainBuildDue, dueBrainBuilds, indexBrain } from "../src/brain/index.js";
import { lastChanges } from "../src/brain/indexer.js";
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
    // The new document and the root carry the commit that changed it; an older document keeps its own.
    expect((await store.node("shop", "00-project/charter.md"))?.changed).toMatchObject({ commit: next });
    expect((await store.node("shop", "/"))?.changed?.commit).toBe(next);
    expect((await store.node("shop", "01-standards/README.md"))?.changed?.commit).toBe(before.indexedCommit);
    const ranged = await store.nodesInRanges("shop", "10-applications/billing/01-legacy/invoice/tax/spec.md", [{ start: 2, end: 7 }], 10);
    expect(ranged.map((node) => node.id)).toEqual([
      "10-applications/billing/01-legacy/invoice/tax/spec.md",
      "10-applications/billing/01-legacy/invoice/tax/spec.md#business-rules",
      "10-applications/billing/01-legacy/invoice/tax/spec.md#RULE-INV01-0001",
    ]);
  });

  it("knows the last change of a document whose name Git would quote or whose extension is upper case", async () => {
    const next = await remote.commitFiles("shop-docs", [
      { path: "00-project/kế hoạch.md", content: "# Kế hoạch\n\nVì sao chuyển đổi.\n" },
      { path: "00-project/NOTES.MD", content: "# Notes\n\nOpen points.\n" },
    ]);
    await syncRepository({ store: deps.repositories, storage: deps.storage }, "shop-docs");
    await indexBrain(deps, "shop");
    expect((await store.node("shop", "00-project/kế hoạch.md"))?.changed?.commit).toBe(next);
    expect((await store.node("shop", "00-project/NOTES.MD"))?.changed?.commit).toBe(next);
  });

  it("leaves out a document over 2 MiB, and keeps one of exactly 2 MiB", async () => {
    const size = BRAIN_MAX_FILE_BYTES;
    await remote.commitFiles("shop-docs", [
      { path: "00-project/bound.md", content: `# Bound\n\n${"x".repeat(size - 10)}\n` },
      { path: "00-project/over.md", content: `# Over\n\n${"x".repeat(size - 8)}\n` },
    ]);
    await syncRepository({ store: deps.repositories, storage: deps.storage }, "shop-docs");
    await indexBrain(deps, "shop");
    expect(await store.node("shop", "00-project/bound.md")).toBeDefined();
    expect(await store.node("shop", "00-project/over.md")).toBeUndefined();
  });

  it("stores the page attributes of builder 6 and reads them back, in the order a home page lists", async () => {
    await remote.commitFiles("shop-docs", [
      { path: "00-project/team/README.md", content: "---\nkey: TEAM\nlabels: [team]\nowner: lead\norder: [second, first]\n---\n\n# Team\n\nThe team's space.\n" },
      { path: "00-project/team/first.md", content: "---\nid: PAGE-TEAM-0001\nlabels:\n  - Runbook\n  - sev1\nstatus: archived\n---\n\n# First\n\nThe first page.\n" },
      { path: "00-project/team/second.md", content: "---\nid: PAGE-TEAM-0002\ntype: template\n---\n\n# Second\n\nThe second page.\n" },
    ]);
    await syncRepository({ store: deps.repositories, storage: deps.storage }, "shop-docs");
    await indexBrain(deps, "shop");

    const first = await store.node("shop", "00-project/team/first.md");
    expect(first).toMatchObject({ labels: ["runbook", "sev1"], status: "archived", owner: null, template: false, space: "TEAM" });
    expect(first?.summary).toMatch(/^Archived\./);
    const second = await store.node("shop", "00-project/team/second.md");
    expect(second).toMatchObject({ labels: [], template: true, space: "TEAM" });
    expect(second?.summary).toMatch(/^Template\./);
    // A folder takes the attributes of its home page, and a section has none.
    expect(await store.node("shop", "00-project/team/")).toMatchObject({ labels: ["team"], owner: "lead", space: "TEAM" });
    expect(await store.node("shop", "00-project/")).toMatchObject({ labels: [], space: null });
    // The listed entries come first, in the home page's order; the home page itself follows.
    const team = await store.children("shop", "00-project/team/", 0, 10);
    expect(team.items.map((node) => node.id)).toEqual(["00-project/team/second.md", "00-project/team/first.md", "00-project/team/README.md"]);
    // The labels are indexed: a lookup by a label is an `@>` on the column.
    const found = await db.pool.query<{ id: string }>("select id from knowledge.brain_node where project_id = 'shop' and labels @> array['runbook']::text[]");
    expect(found.rows.map((row) => row.id)).toEqual(["00-project/team/first.md"]);
    expect((await store.byLabel("shop", "runbook", 10)).map((node) => node.id)).toEqual(["00-project/team/first.md"]);
    expect(await store.byLabel("shop", "nothing", 10)).toEqual([]);
    expect((await store.bySpace("shop", "TEAM", 10)).map((node) => node.id)).toEqual(["00-project/team/README.md", "00-project/team/first.md", "00-project/team/second.md"]);
    expect(await store.bySpace("shop", "team", 10)).toEqual([]);
  });

  it("fails the build of a project without a document repository", async () => {
    await db.pool.query("insert into admin.project (id, name) values ('bare', 'Bare')");
    await store.configure("bare", { branch: "main", enabled: true }, "alice");
    expect(await indexBrain(deps, "bare")).toEqual({ status: "failed", error: "The project has no document repository." });
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

describe.skipIf(!hasDatabase)("brain links of a node over the cap (integration, P-036)", () => {
  let db: TestDatabase;
  let store: PgBrainStore;
  const INDEX = "00-project/index.md";

  beforeAll(async () => {
    db = await createTestDatabase();
    store = new PgBrainStore(db.pool);
    await db.pool.query("insert into admin.project (id, name) values ('wide', 'Wide')");
    await store.configure("wide", { branch: "main", enabled: true }, "alice");
  });
  afterAll(async () => {
    await db?.drop();
  });

  const build = (count: number) =>
    buildBrainTree(
      [
        { path: INDEX, text: `# Index\n\n${Array.from({ length: count }, (_, n) => `- [Page ${n}](p${n}.md)`).join("\n")}` },
        ...Array.from({ length: count }, (_, n) => ({ path: `00-project/p${n}.md`, text: `# Page ${n}\n\nText.` })),
      ],
      "wide @ main",
    );

  it("stores the cap and says how many links there are, at the cap and one over it", async () => {
    for (const count of [BRAIN_MAX_LINKS_PER_NODE, BRAIN_MAX_LINKS_PER_NODE + 1]) {
      await store.replace("wide", "c".repeat(40), BRAIN_BUILDER_VERSION, build(count), { durationMs: 1 });
      const stored = await db.pool.query<{ count: string }>("select count(*) from knowledge.brain_link where project_id = 'wide' and from_id = $1", [INDEX]);
      expect(Number(stored.rows[0]?.count), String(count)).toBe(BRAIN_MAX_LINKS_PER_NODE);
      const links = await store.links("wide", INDEX, 20);
      expect(links.outgoing, String(count)).toHaveLength(20);
      expect(links.outgoingTotal, String(count)).toBe(count);
      // The pages link nowhere; the one that points at them is counted once per page.
      expect((await store.links("wide", "00-project/p0.md", 20)).incomingTotal).toBe(1);
    }
  });
});

describe("lastChanges", () => {
  let dir: string;
  let mirror: string;
  let one: string;
  let two: string;
  let three: string;
  const git = (args: string[], input?: string, date?: string) =>
    execFileSync("git", ["--git-dir", mirror, ...args], {
      input,
      encoding: "utf8",
      env: { ...process.env, GIT_INDEX_FILE: join(dir, "index"), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ...(date === undefined ? {} : { GIT_COMMITTER_DATE: date }) },
    }).trim();
  const commit = (files: Record<string, string>, message: string, date: string, parent?: string): string => {
    git(["read-tree", "--empty"]);
    for (const [path, text] of Object.entries(files)) git(["update-index", "--add", "--cacheinfo", `100644,${git(["hash-object", "-w", "--stdin"], text)},${path}`]);
    return git(["commit-tree", git(["write-tree"]), "-m", message, ...(parent === undefined ? [] : ["-p", parent])], undefined, date);
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kintsugi-history-"));
    mirror = join(dir, "docs.git");
    execFileSync("git", ["init", "-q", "--bare", mirror]);
    const files = { "a.md": "a", "kế hoạch.md": "k", "Docs/UP.MD": "u", "notes.txt": "n" };
    one = commit(files, "one", "2026-10-01T00:00:00Z");
    two = commit({ ...files, "a.md": "a2" }, `two ${"x".repeat(300)}`, "2026-10-02T00:00:00Z", one);
    three = commit({ ...files, "a.md": "a2", "b.md": "b" }, "three", "2026-10-03T00:00:00Z", two);
  });
  afterAll(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("finds the newest change of each path, whatever Git would quote, its subject cut short", async () => {
    const found = await lastChanges(mirror, three, new Set(["a.md", "kế hoạch.md", "Docs/UP.MD", "b.md", "missing.md"]));
    expect(found.get("a.md")).toEqual({ commit: two, at: "2026-10-02T00:00:00.000Z", subject: `two ${"x".repeat(196)}` });
    expect(found.get("kế hoạch.md")?.commit).toBe(one);
    expect(found.get("Docs/UP.MD")?.commit).toBe(one);
    expect(found.get("b.md")).toMatchObject({ commit: three, subject: "three" });
    expect(found.has("missing.md")).toBe(false);
    expect((await lastChanges(mirror, one, new Set(["a.md"]))).get("a.md")?.commit).toBe(one);
  });

  it("leaves every change unknown when the history cannot be read", async () => {
    expect((await lastChanges(join(dir, "nowhere.git"), three, new Set(["a.md"]))).size).toBe(0);
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
