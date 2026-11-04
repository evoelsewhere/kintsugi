// The text index of the Brain (P4-001, ADR-0097 decision 7): one weighted tsvector for each document, section and card,
// written in the transaction of the tree. Against a real git remote and a throwaway database: what a node is found by, how
// a word in a title ranks against the same word in a body, that no text is stored, and that a whole build and an
// incremental build of one commit write the same rows.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BRAIN_BUILDER_VERSION } from "@kintsugi/domain";
import { CheckoutStorage } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexBrain } from "../src/brain/indexer.js";
import { PgBrainStore } from "../src/brain/store.js";
import { RepositoryStore } from "../src/git-sync/repositories.js";
import { syncRepository } from "../src/git-sync/sync.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

const PAGES: Record<string, string> = {
  "20-spaces/eng/README.md": "---\nkey: ENG\n---\n\n# Engineering\n\nThe engineering space.\n",
  "20-spaces/eng/gateway.md": "---\ntitle: Payment gateway\nlabels: [billing, Settlement]\n---\n\n# Payment gateway\n\nHow cards are accepted. A refund is rare.\n\n## Timeouts\n\nThe gateway waits ten seconds.\n",
  "20-spaces/eng/refunds.md": "---\ntitle: Refund policy\n---\n\n# Refund policy\n\nMoney goes back in three days when payment failed.\n",
  "20-spaces/eng/deploy.md": "# Deploy\n\nSteps to ship.\n\n## Rollback\n\nRun this:\n\n```sh\nkubectl rollout undo\nchargeCustomer(order)\n```\n\n### RULE-PAY-0001: Late fee\n\n- **priority:** P0\n- the invoice is overdue after thirty days\n",
  "restricted/secret.md": "# Secret\n\nA refund of one million.\n",
  "_generated/index.md": "# Generated\n\nA refund list.\n",
  ".hidden/notes.md": "# Hidden\n\nA refund note.\n",
};

describe.skipIf(!hasDatabase)("the text index of the Brain (integration)", () => {
  let db: TestDatabase;
  let remote: GitHttpServer;
  let dataDir: string;
  let work: string;
  let gitDir: string;
  let deps: Parameters<typeof indexBrain>[0];
  let store: PgBrainStore;
  const sql = (text: string, values: unknown[] = []) => db.pool.query(text, values);
  const git = (...args: string[]): string => execFileSync("git", ["-C", work, "-c", "core.autocrlf=false", ...args], { encoding: "utf8" });

  async function commit(changes: { write?: Record<string, string>; remove?: string[]; rename?: Array<[string, string]> }): Promise<unknown> {
    for (const [path, content] of Object.entries(changes.write ?? {})) {
      await mkdir(dirname(join(work, path)), { recursive: true });
      await writeFile(join(work, path), content);
    }
    for (const path of changes.remove ?? []) git("rm", "-q", path);
    for (const [from, to] of changes.rename ?? []) {
      await mkdir(dirname(join(work, to)), { recursive: true });
      git("mv", from, to);
    }
    git("add", "-A");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "edit");
    git("push", "-q", gitDir, "HEAD:main");
    await syncRepository({ store: deps.repositories, storage: deps.storage }, "wiki-docs");
    return indexBrain(deps, "wiki");
  }
  const rows = async () => (await sql("select node_id, tsv::text as tsv from knowledge.brain_text where project_id = 'wiki' order by node_id collate \"C\"")).rows as Array<{ node_id: string; tsv: string }>;
  /** The nodes a query finds, best first (ts_rank_cd, ties by node id), as the search of the next ticket will ask. */
  const search = async (text: string) =>
    (await sql(
      `select node_id from knowledge.brain_text, websearch_to_tsquery('simple', $1) as q
        where project_id = 'wiki' and tsv @@ q order by ts_rank_cd(tsv, q) desc, node_id collate "C"`,
      [text],
    )).rows.map((row) => row.node_id as string);

  beforeAll(async () => {
    process.env["KINTSUGI_SECRET_KEY"] ??= randomBytes(32).toString("base64");
    db = await createTestDatabase();
    remote = await startGitHttpServer();
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-brain-text-"));
    const storage = new CheckoutStorage(dataDir);
    await storage.prepare();
    deps = { pool: db.pool, repositories: new RepositoryStore(db.pool), storage, log: () => undefined };
    store = new PgBrainStore(db.pool);
    await remote.createRepository("wiki-docs");
    await remote.commitFiles("wiki-docs", Object.entries(PAGES).map(([path, content]) => ({ path, content })));
    gitDir = remote.git("wiki-docs", "rev-parse", "--absolute-git-dir").trim();
    work = await mkdtemp(join(tmpdir(), "kintsugi-brain-text-work-"));
    execFileSync("git", ["clone", "-q", "-c", "core.autocrlf=false", gitDir, work]);
    git("checkout", "-q", "main");
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('internal', 'plain-git', 'Internal', $1, 'none')", [remote.baseUrl]);
    await db.pool.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('wiki-docs', 'internal', $1, 'main')", [`${remote.baseUrl}/wiki-docs.git`]);
    await db.pool.query("insert into admin.project (id, name) values ('wiki', 'Wiki')");
    await db.pool.query("insert into admin.project_repository (project_id, repository_id, role) values ('wiki', 'wiki-docs', 'document')");
    await syncRepository({ store: deps.repositories, storage }, "wiki-docs");
    await store.configure("wiki", { branch: "main", enabled: true }, "alice");
  }, 120_000);
  afterAll(async () => {
    await remote?.close();
    await db?.drop();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
    if (work !== undefined) await rm(work, { recursive: true, force: true });
  });

  it("is built by builder 7 with the tree: a row for each document, section and card, none for what the builder skips", async () => {
    expect(BRAIN_BUILDER_VERSION).toBe(7);
    expect(await indexBrain(deps, "wiki")).toMatchObject({ status: "built", mode: "whole" });
    const nodes = (await sql("select id from knowledge.brain_node where project_id = 'wiki' and kind in ('document', 'section', 'card') order by id collate \"C\"")).rows.map((row) => row.id as string);
    expect((await rows()).map((row) => row.node_id)).toEqual(nodes);
    expect(nodes).toContain("20-spaces/eng/deploy.md#RULE-PAY-0001");
    // What the tree skips has no row (restricted records, hidden folders); `_generated/` is in the tree today, so it has rows.
    for (const skipped of ["restricted", ".hidden"]) expect((await rows()).filter((row) => row.node_id.startsWith(skipped))).toEqual([]);
    expect((await sql("select builder_version from knowledge.brain_source where project_id = 'wiki'")).rows[0]).toEqual({ builder_version: 7 });
  });

  it("finds a node by a word in its title, in its body, in a label and in a heading under it, and in code", async () => {
    expect(await search("gateway")).toEqual(expect.arrayContaining(["20-spaces/eng/gateway.md", "20-spaces/eng/gateway.md#timeouts"]));
    expect(await search("accepted")).toEqual(["20-spaces/eng/gateway.md"]); // its own lines
    expect(await search("settlement")).toEqual(["20-spaces/eng/gateway.md"]); // a label, in any case
    expect(await search("timeouts")).toEqual(expect.arrayContaining(["20-spaces/eng/gateway.md", "20-spaces/eng/gateway.md#timeouts"])); // the heading, and the document it is in
    expect(await search("rollback")).toEqual(expect.arrayContaining(["20-spaces/eng/deploy.md", "20-spaces/eng/deploy.md#rollback"]));
    // Code is kept: a developer looks for the name of a function.
    expect(await search("chargecustomer")).toContain("20-spaces/eng/deploy.md#rollback");
    // The lines of a node are its own: a word in a child section does not make the parent's body hold it.
    expect(await search("overdue")).toEqual(["20-spaces/eng/deploy.md#RULE-PAY-0001"]);
  });

  it("ranks a word in a title above the same word in a body", async () => {
    // "refund" is the title of refunds.md and a word of the body of gateway.md.
    expect(await search("refund")).toEqual(["20-spaces/eng/refunds.md", "20-spaces/eng/gateway.md", "_generated/index.md"]);
    const ranks = await sql(
      `select node_id, ts_rank_cd(tsv, websearch_to_tsquery('simple', 'refund')) as rank from knowledge.brain_text where project_id = 'wiki' and node_id in ('20-spaces/eng/refunds.md', '20-spaces/eng/gateway.md')`,
    );
    const rank = new Map(ranks.rows.map((row) => [row.node_id as string, Number(row.rank)]));
    expect(rank.get("20-spaces/eng/refunds.md")!).toBeGreaterThan(rank.get("20-spaces/eng/gateway.md")!);
  });

  it("holds lexemes with their weights, not the text", async () => {
    const gateway = (await rows()).find((row) => row.node_id === "20-spaces/eng/gateway.md")!.tsv;
    expect(gateway).toMatch(/'billing':\d+B/);
    expect(gateway).toMatch(/'payment':\d+A/);
    expect(gateway).toMatch(/'accepted':\d+C/);
    expect(gateway).not.toContain("How cards are accepted");
    expect(gateway).not.toMatch(/How cards|accepted\./);
    // A phrase, or any other sentence of a page, is not recoverable from the table.
    expect(JSON.stringify(await rows())).not.toContain("Money goes back in three days");
  });

  it("follows an edit, a deleted document and a moved one, so that a whole build writes the same rows", async () => {
    expect(await commit({ write: { "20-spaces/eng/refunds.md": "---\ntitle: Refund policy\n---\n\n# Refund policy\n\nMoney goes back in five days when payment failed. Chargeback rules differ.\n" } })).toMatchObject({ status: "built", mode: "incremental" });
    expect(await search("chargeback")).toEqual(["20-spaces/eng/refunds.md"]);
    expect(await search("three")).toEqual([]); // the old words are gone

    expect(await commit({ remove: ["20-spaces/eng/refunds.md"], rename: [["20-spaces/eng/gateway.md", "20-spaces/eng/payments/gateway.md"]] })).toMatchObject({ status: "built" });
    const ids = (await rows()).map((row) => row.node_id);
    expect(ids.filter((id) => id.startsWith("20-spaces/eng/refunds.md"))).toEqual([]);
    expect(ids.filter((id) => id.startsWith("20-spaces/eng/gateway.md"))).toEqual([]);
    expect(ids).toEqual(expect.arrayContaining(["20-spaces/eng/payments/gateway.md", "20-spaces/eng/payments/gateway.md#timeouts"]));

    expect(await commit({ write: { "20-spaces/eng/deploy.md": "# Deploy\n\nSteps to ship, now with a canary.\n\n## Rollback\n\nRun `undo`.\n" } })).toMatchObject({ status: "built", mode: "incremental" });
    expect(await search("canary")).toEqual(["20-spaces/eng/deploy.md"]);
    expect(await search("overdue")).toEqual([]); // the card is gone with its rows
    const incremental = await rows();

    // The same commit built whole: the same rows.
    await sql("update knowledge.brain_source set refs_complete = false where project_id = 'wiki'");
    expect(await indexBrain(deps, "wiki")).toMatchObject({ status: "built", mode: "whole" });
    expect(await rows()).toEqual(incremental);
    expect((await sql("select count(*)::int as n from knowledge.brain_node where project_id = 'wiki' and kind in ('document', 'section', 'card')")).rows[0]).toEqual({ n: incremental.length });
  });

  it("goes with the index of the project", async () => {
    await sql("delete from knowledge.brain_source where project_id = 'wiki'");
    expect(await rows()).toEqual([]);
  });
});
