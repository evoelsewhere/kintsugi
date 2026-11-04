// Incremental Brain builds (ADR-0097 decision 6) against a real git remote and a throwaway database: a build that reads
// only what changed stores the same rows as a whole build of the same commit, and every condition that makes it unsafe
// falls back to a whole build.

import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRAIN_BUILDER_VERSION, BRAIN_WHOLE_BUILD_EVERY, type BrainSource } from "@kintsugi/domain";
import { CheckoutStorage } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexBrain, wholeBuildReason } from "../src/brain/indexer.js";
import { PgBrainStore, StaleBaseError } from "../src/brain/store.js";
import { RepositoryStore } from "../src/git-sync/repositories.js";
import { syncRepository } from "../src/git-sync/sync.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

const PAGES: Record<string, string> = {
  "00-project/charter.md": "# Charter\n\nWhy we migrate. See [the standards](../01-standards/README.md).\n",
  "01-standards/README.md": "# Standards\n\nHow this project writes code.\n",
  "01-standards/naming.md": "# Naming\n\nNames follow the [standards](README.md) and RULE-AAA-0001.\n",
  "20-spaces/eng/README.md": "---\nkey: ENG\nlabels: [eng]\norder:\n  - setup\n  - intro\n---\n\n# Engineering\n\nThe engineering space.\n",
  "20-spaces/eng/intro.md": "---\nlabels: [onboarding]\n---\n\n# Intro\n\n## Goals\n\nShip the migration.\n",
  "20-spaces/eng/setup.md": "# Setup\n\nStart at [the goals](intro.md#goals) and read RULE-AAA-0001.\n",
  "20-spaces/eng/rules.md": "# Rules\n\n### RULE-AAA-0001: Late fee\n\n- **priority:** P0\n",
  "20-spaces/eng/runbooks/README.md": "# Runbooks\n\nWhat to do when it breaks.\n",
  "20-spaces/eng/runbooks/db.md": "---\nlabels: [runbook, sev1]\nstatus: current\n---\n\n# Database\n\nSee [the late fee](../rules.md#rule-aaa-0001-late-fee).\n",
  "20-spaces/hr/README.md": "---\nkey: HR\n---\n\n# People\n\nThe people space.\n",
  "20-spaces/hr/leave.md": "# Leave\n\nSee [the plan](../eng/missing.md) for the rest.\n",
  "20-spaces/hr/benefits.md": "# Benefits\n\nHealth and more.\n",
};

describe.skipIf(!hasDatabase)("incremental Brain builds (integration)", () => {
  let db: TestDatabase;
  let remote: GitHttpServer;
  let dataDir: string;
  let deps: Parameters<typeof indexBrain>[0];
  let store: PgBrainStore;
  let edit = 0;

  /** Commits a one-page change, brings the mirror up to date and builds the Brain. */
  async function change(files: Record<string, string> = { "20-spaces/eng/setup.md": `# Setup\n\nStart at [the goals](intro.md#goals) and read RULE-AAA-0001. Edit ${(edit += 1)}.\n` }) {
    await remote.commitFiles("wiki-docs", Object.entries(files).map(([path, content]) => ({ path, content })));
    await syncRepository({ store: deps.repositories, storage: deps.storage }, "wiki-docs");
    return indexBrain(deps, "wiki");
  }
  const sql = (text: string, values: unknown[] = []) => db.pool.query(text, values);
  const mode = async (outcome: ReturnType<typeof change>): Promise<string> => {
    const built = await outcome;
    return built.status === "built" ? built.mode : built.status;
  };

  /** Everything a build stores about the tree, in a fixed order; what two builds of one commit must share. */
  async function dump() {
    const rows = async (query: string) => (await sql(query)).rows;
    return {
      nodes: await rows("select id, parent_id, kind, path, anchor, title, summary, summary_source, ordinal, depth, line_start, line_end, subtree_end, tokens, subtree_tokens, children, ids, labels, status, owner, template, space, changed_commit, changed_at, changed_subject, outgoing_links, home from knowledge.brain_node where project_id = 'wiki' order by id collate \"C\""),
      links: await rows("select from_id, to_id, kind from knowledge.brain_link where project_id = 'wiki' order by from_id collate \"C\", to_id collate \"C\""),
      refs: await rows("select path, ordinal, from_id, kind, target_path, target_anchor, target_id from knowledge.brain_ref where project_id = 'wiki' order by path collate \"C\", ordinal"),
      // The text index of every node (builder 7): identical for a whole and an incremental build of one commit.
      text: await rows("select node_id, tsv::text as tsv from knowledge.brain_text where project_id = 'wiki' order by node_id collate \"C\""),
      source: await rows("select indexed_commit, builder_version, documents, nodes, identifiers, links, tokens, skipped, broken, refs_complete from knowledge.brain_source where project_id = 'wiki'"),
    };
  }
  const state = async () => (await sql("select last_build, incremental_builds, whole_built_at, refs_complete from knowledge.brain_source where project_id = 'wiki'")).rows[0] as {
    last_build: string;
    incremental_builds: number;
    whole_built_at: Date | null;
    refs_complete: boolean;
  };

  beforeAll(async () => {
    process.env["KINTSUGI_SECRET_KEY"] ??= randomBytes(32).toString("base64");
    db = await createTestDatabase();
    remote = await startGitHttpServer();
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-brain-inc-"));
    const storage = new CheckoutStorage(dataDir);
    await storage.prepare();
    const repositories = new RepositoryStore(db.pool);
    deps = { pool: db.pool, repositories, storage, log: () => undefined };
    store = new PgBrainStore(db.pool);
    await remote.createRepository("wiki-docs");
    await remote.commitFiles("wiki-docs", Object.entries(PAGES).map(([path, content]) => ({ path, content })));
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('internal', 'plain-git', 'Internal', $1, 'none')", [remote.baseUrl]);
    await db.pool.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('wiki-docs', 'internal', $1, 'main')", [`${remote.baseUrl}/wiki-docs.git`]);
    await db.pool.query("insert into admin.project (id, name) values ('wiki', 'Wiki')");
    await db.pool.query("insert into admin.project_repository (project_id, repository_id, role) values ('wiki', 'wiki-docs', 'document')");
    await syncRepository({ store: repositories, storage }, "wiki-docs");
    await store.configure("wiki", { branch: "main", enabled: true }, "alice");
  });
  afterAll(async () => {
    await remote?.close();
    await db?.drop();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  });

  it("builds the first time whole, and keeps the references and the page data a later build needs", async () => {
    const first = await indexBrain(deps, "wiki");
    expect(first).toMatchObject({ status: "built", mode: "whole", documents: 13 });
    expect(await state()).toMatchObject({ last_build: "whole", incremental_builds: 0, refs_complete: true });
    expect((await state()).whole_built_at).not.toBeNull();
    // The link to a page that is not there is a reference of its page, and a broken link of the build.
    const missing = await sql("select path, from_id, kind, target_path from knowledge.brain_ref where project_id = 'wiki' and target_path = '20-spaces/eng/missing.md'");
    expect(missing.rows).toEqual([{ path: "20-spaces/hr/leave.md", from_id: "20-spaces/hr/leave.md", kind: "link", target_path: "20-spaces/eng/missing.md" }]);
    expect((await sql("select broken from knowledge.brain_source where project_id = 'wiki'")).rows[0]).toEqual({ broken: [{ from: "20-spaces/hr/leave.md", target: "20-spaces/eng/missing.md" }] });
    // A home page keeps its key and order, a card its anchor alias.
    const homes = await sql("select id, home from knowledge.brain_node where project_id = 'wiki' and home is not null order by id collate \"C\"");
    expect(homes.rows).toContainEqual({ id: "20-spaces/eng/README.md", home: { key: "ENG", order: ["setup", "intro"] } });
    expect(homes.rows).toContainEqual({ id: "20-spaces/eng/rules.md#RULE-AAA-0001", home: { alias: "rule-aaa-0001-late-fee" } });
  });

  it("stores the rows of a whole build when it reads only the documents that changed (a page and a home page's key)", async () => {
    const outcome = await change({
      "20-spaces/eng/setup.md": "# Setup\n\nStart at [the goals](intro.md#goals), see [the leave plan](../hr/leave.md) and read RULE-AAA-0001.\n\n## After\n\nDone.\n",
      "20-spaces/hr/README.md": "---\nkey: HRX\nlabels: [people]\n---\n\n# People\n\nThe people space.\n",
    });
    expect(outcome).toMatchObject({ status: "built", mode: "incremental", documents: 13 });
    expect(await state()).toMatchObject({ last_build: "incremental", incremental_builds: 1, refs_complete: true });
    const incremental = await dump();
    // The key moved the whole space: the pages of it that did not change carry it too.
    expect((await store.node("wiki", "20-spaces/hr/benefits.md"))?.space).toBe("HRX");
    expect((await store.node("wiki", "20-spaces/hr/leave.md"))?.space).toBe("HRX");

    // A manager's Rebuild is a whole build of the same commit.
    await store.request("wiki", "alice");
    expect(await indexBrain(deps, "wiki")).toMatchObject({ status: "built", mode: "whole", commit: incremental.source[0]?.indexed_commit });
    expect(await state()).toMatchObject({ last_build: "whole", incremental_builds: 0 });
    expect(await dump()).toEqual(incremental);
  });

  it("is incremental again on the next change, and writes only the rows that differ", async () => {
    expect(await mode(change())).toBe("incremental");
    const before = await sql("select id, changed_commit from knowledge.brain_node where project_id = 'wiki' and kind = 'document' order by id collate \"C\"");
    expect(await mode(change())).toBe("incremental");
    const after = await sql("select id, changed_commit from knowledge.brain_node where project_id = 'wiki' and kind = 'document' order by id collate \"C\"");
    const moved = after.rows.filter((row, index) => row.changed_commit !== before.rows[index]?.changed_commit).map((row) => row.id);
    expect(moved).toEqual(["20-spaces/eng/setup.md"]);
  });

  it("builds whole when more than a fifth of the documents changed", async () => {
    expect(await mode(change({ "20-spaces/eng/intro.md": "# Intro\n\n## Goals\n\nShip it.\n", "20-spaces/eng/rules.md": "# Rules\n\n### RULE-AAA-0001: Late fee\n\n- **priority:** P1\n", "00-project/charter.md": "# Charter\n\nWhy.\n" }))).toBe("whole");
    expect(await mode(change())).toBe("incremental");
  });

  it("builds whole when the stored commit is not an ancestor of the new one", async () => {
    await sql("update knowledge.brain_source set indexed_commit = $1 where project_id = 'wiki'", ["a".repeat(40)]);
    expect(await mode(change())).toBe("whole");
    expect(await mode(change())).toBe("incremental");
  });

  it.each([
    ["the references are not those of a whole build", "update knowledge.brain_source set refs_complete = false where project_id = 'wiki'"],
    ["another builder version built the tree", "update knowledge.brain_source set builder_version = builder_version - 1 where project_id = 'wiki'"],
    [`${BRAIN_WHOLE_BUILD_EVERY} incremental builds have followed the whole one`, `update knowledge.brain_source set incremental_builds = ${BRAIN_WHOLE_BUILD_EVERY} where project_id = 'wiki'`],
    ["the whole build is more than a day old", "update knowledge.brain_source set whole_built_at = now() - interval '2 days' where project_id = 'wiki'"],
    ["documents were left out of the stored tree", "update knowledge.brain_source set skipped = 1 where project_id = 'wiki'"],
    ["the stored documents are not those of the commit", "delete from knowledge.brain_node where project_id = 'wiki' and path = '20-spaces/hr/benefits.md'"],
  ])("builds whole when %s, and is incremental again after", async (_name, breakIt) => {
    expect(await mode(change())).toBe("incremental");
    await sql(breakIt);
    const whole = await change();
    expect(whole).toMatchObject({ status: "built", mode: "whole" });
    expect(await state()).toMatchObject({ last_build: "whole", incremental_builds: 0, refs_complete: true });
    // What it wrote is the tree the commit has, whatever was wrong before.
    expect((await sql("select count(*)::int as n from knowledge.brain_node where project_id = 'wiki' and kind = 'document'")).rows[0]).toEqual({ n: 13 });
    expect(await mode(change())).toBe("incremental");
  });

  it("refuses to write an incremental build when another build moved the index on (nothing is written)", async () => {
    const source = (await store.source("wiki")) as BrainSource;
    const rows = await dump();
    await expect(
      store.applyDelta("wiki", "b".repeat(40), "c".repeat(40), BRAIN_BUILDER_VERSION, { nodes: [], links: [], documents: 0, identifiers: 0, skipped: 0, linkTotals: {}, broken: [], warnings: [] }, { durationMs: 1 }, [], []),
    ).rejects.toBeInstanceOf(StaleBaseError);
    expect(await dump()).toEqual(rows);
    expect((await store.source("wiki"))?.indexedCommit).toBe(source.indexedCommit);
  });
});

describe("wholeBuildReason", () => {
  const NOW = Date.parse("2026-11-04T12:00:00Z");
  const source = { builderVersion: BRAIN_BUILDER_VERSION, indexedCommit: "a".repeat(40), skipped: 0 } as BrainSource;
  const state = { incrementalBuilds: 3, wholeBuiltAt: "2026-11-04T08:00:00Z", refsComplete: true };
  const tip = "b".repeat(40);

  it("allows an incremental build of an index a whole build of this version wrote a few hours ago", () => {
    expect(wholeBuildReason(source, state, tip, NOW)).toBeUndefined();
  });

  it.each([
    ["no state", source, undefined, tip],
    ["references not complete", source, { ...state, refsComplete: false }, tip],
    ["another builder version", { ...source, builderVersion: BRAIN_BUILDER_VERSION - 1 }, state, tip],
    ["never built", { ...source, indexedCommit: null }, state, tip],
    ["the same commit", source, state, "a".repeat(40)],
    ["documents left out", { ...source, skipped: 2 }, state, tip],
    ["the fiftieth incremental build", source, { ...state, incrementalBuilds: BRAIN_WHOLE_BUILD_EVERY }, tip],
    ["no whole build recorded", source, { ...state, wholeBuiltAt: null }, tip],
    ["a whole build a day old", source, { ...state, wholeBuiltAt: "2026-11-03T12:00:00Z" }, tip],
  ] as const)("says why a whole build is needed: %s", (_name, built, buildState, commit) => {
    expect(wholeBuildReason(built as BrainSource, buildState, commit, NOW)).toEqual(expect.any(String));
  });

  it("still allows the forty-ninth incremental build", () => {
    expect(wholeBuildReason(source, { ...state, incrementalBuilds: BRAIN_WHOLE_BUILD_EVERY - 1 }, tip, NOW)).toBeUndefined();
  });
});
