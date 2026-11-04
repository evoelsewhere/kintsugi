// The ranked search of the Brain (P4-002, ADR-0097 decision 7) on the wiki fixture of the Brain eval: the pages people mean
// are in the first five hits for words they would type, each hit has its breadcrumb, summary, matching line and a
// citation at the indexed commit, archived pages and templates are left out and counted, and the route is for people in
// the portal only. The mirror is a real clone of the fixture; the Brain is built by the worker's own function.

import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { RepositoryStore } from "@kintsugi/orchestrator";
import { indexBrain } from "@kintsugi/orchestrator/brain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, currentUserId, grantProjectAccess, memberClient, startTestApp, type TestApp } from "../support/app.js";
import { hasDatabase } from "../support/database.js";

interface Hit {
  node: { id: string; kind: string; path: string; title: string; anchor: string | null };
  breadcrumb: Array<{ id: string; kind: string; title: string }>;
  summary: string;
  line: { number: number; text: string } | null;
  citation: string;
  rank: number;
}
interface SearchView {
  commit: string;
  hits: Hit[];
  leftOut: { archived: number; templates: number };
}

const FIXTURE = resolve(import.meta.dirname, "../../../../packages/agents/evals/brain/fixture/wiki-docs");
const SOURCES = ["apps/api/src/modules/delivery/member-api", "services/harness-hub/src", "packages/harness-sdk/src", "packages/cli/src", "packages/kintsugi-client/src"].map((path) => resolve(import.meta.dirname, "../../../..", path));

/** The questions people type (acceptance-phase-4): words, not phrases of the pages. */
const QUESTIONS: Array<[string, string, { archived?: boolean }?]> = [
  ["database failover steps", "20-spaces/eng/runbooks/db-failover.md"],
  ["carry over unused leave", "20-spaces/hr/leave-policy.md"],
  ["sick leave rules", "20-spaces/hr/leave-policy.md"],
  ["health plan claims", "20-spaces/hr/benefits/health.md"],
  ["on call escalation", "20-spaces/ops/on-call.md"],
  ["rollback after payment outage", "20-spaces/eng/runbooks/payment-outage.md"],
  ["laptop install troubleshooting", "20-spaces/eng/onboarding/laptop-setup.md"],
  ["offboarding access requests", "20-spaces/eng/onboarding/access-requests.md"],
  // The decision is archived (superseded): it is found when archived pages are asked for.
  ["why we use postgres", "20-spaces/eng/decisions/0001-use-postgres.md", { archived: true }],
  ["queue for background work consequences", "20-spaces/eng/decisions/0002-use-queues.md"],
  ["remote work equipment", "20-spaces/hr/remote-work.md"],
  ["checkout service dependencies", "20-spaces/ops/services/checkout.md"],
  ["flush the cache", "20-spaces/eng/runbooks/cache-flush.md"],
  ["feature flag symptoms", "20-spaces/eng/runbooks/feature-flags.md"],
];

const walk = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { withFileTypes: true })).flatMap((entry) => (entry.isDirectory() ? [] : [join(dir, entry.name)])).concat(...(await Promise.all((await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => walk(join(dir, entry.name))))));

describe.skipIf(!hasDatabase)("brain search (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let work: string;
  let pool: pg.Pool;
  let reader: Client;
  let indexed: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const build = () => indexBrain({ pool, repositories: new RepositoryStore(pool), storage: new CheckoutStorage(dataDir), log: () => undefined }, "shop");
  const search = (client: Client, query: string) => client.get<SearchView>(`/projects/shop/brain/search?${query}`);
  const find = async (query: string): Promise<SearchView> => (await search(reader, query)).body.data!;

  /**
   * The full-text index is written by the Brain's builder (P4-001). Where it has not written one, the same vectors are made
   * here from the tree and the files, with the weights of the design (title, then headings and labels, then the node's own
   * text), so the route is tested on what it reads whichever builder ran.
   */
  const ensureIndex = async (): Promise<void> => {
    const exists = (await app.db.query<{ t: string | null }>("select to_regclass('knowledge.brain_text')::text as t")).rows[0]!.t !== null;
    if (exists && ((await app.db.query("select 1 from knowledge.brain_text limit 1")).rowCount ?? 0) > 0) return;
    await app.db.query("create table if not exists knowledge.brain_text (project_id text not null, node_id text not null, tsv tsvector not null, primary key (project_id, node_id))");
    const nodes = (await app.db.query<{ id: string; path: string; kind: string; title: string; labels: string[]; line_start: number; line_end: number }>("select id, path, kind, title, labels, line_start, line_end from knowledge.brain_node where project_id = 'shop' and kind in ('document', 'section', 'card')")).rows;
    const pageTitle = new Map(nodes.filter((node) => node.kind === "document").map((node) => [node.path, node.title]));
    const files = new Map<string, string[]>();
    for (const node of nodes) {
      if (!files.has(node.path)) files.set(node.path, (await readFile(join(work, node.path), "utf8")).split("\n"));
      const own = (files.get(node.path) ?? []).slice(node.line_start - 1, node.line_end).join(" ");
      const headings = node.kind === "document" ? "" : (pageTitle.get(node.path) ?? "");
      await app.db.query("insert into knowledge.brain_text (project_id, node_id, tsv) values ('shop', $1, setweight(to_tsvector('simple', $2), 'A') || setweight(to_tsvector('simple', $3), 'B') || setweight(to_tsvector('simple', $4), 'C'))", [node.id, node.title, `${headings} ${node.labels.join(" ")}`, own]);
    }
  };

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-search-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    work = join(dataDir, "work");
    await cp(FIXTURE, work, { recursive: true });
    // Material that must never be searched.
    await mkdir(join(work, "restricted"), { recursive: true });
    await mkdir(join(work, "_generated"), { recursive: true });
    await writeFile(join(work, "restricted/secret.md"), "# Vault\n\nThe zebrafish passphrase is kept here.\n");
    await writeFile(join(work, "_generated/out.md"), "# Output\n\nA generated zebrafish report.\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: work, env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } });
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("commit", "-q", "-m", "wiki docs");
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    execFileSync("git", ["clone", "-q", "--bare", work, new CheckoutStorage(dataDir).mirror("local", "docs")]);

    app = await startTestApp();
    pool = new pg.Pool({ connectionString: app.db.url, max: 2 });
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
    ({ client: reader } = await memberClient(app, admin, "reader-r", ["user"], ["shop"]));
  }, 180_000);
  afterAll(async () => {
    await pool?.end();
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("answers 409 while the Brain is not built, and 400 for a text that is empty, too long or a limit out of range", async () => {
    expect((await search(reader, "text=failover")).status).toBe(409);
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true } })).status).toBe(200);
    expect(await build()).toMatchObject({ status: "built" });
    indexed = (await app.db.query<{ indexed_commit: string }>("select indexed_commit from knowledge.brain_source where project_id = 'shop'")).rows[0]!.indexed_commit;
    await ensureIndex();
    for (const query of ["", "text=", "text=%20%20", `text=${"a".repeat(201)}`, "text=failover&limit=0", "text=failover&limit=21", "text=failover&space=a", "text=failover&label=%21%21", "text=failover&archived=maybe"]) {
      expect((await search(reader, query)).status, query).toBe(400);
    }
  });

  it("finds the page people mean in the first five hits, for at least 12 of 14 questions", async () => {
    const positions: string[] = [];
    let found = 0;
    for (const [text, expected, options] of QUESTIONS) {
      const view = await find(`text=${encodeURIComponent(text)}${options?.archived === true ? "&archived=true" : ""}&limit=20`);
      const pages: string[] = [];
      for (const hit of view.hits) if (!pages.includes(hit.node.path)) pages.push(hit.node.path);
      const at = pages.indexOf(expected);
      positions.push(`${text} -> ${at + 1 === 0 ? "-" : at + 1}`);
      if (at >= 0 && at < 5) found += 1;
    }
    console.log(`brain search positions:\n${positions.join("\n")}`);
    expect(found, positions.join("; ")).toBeGreaterThanOrEqual(12);
  });

  it("gives each hit its breadcrumb, summary, matching line and a citation at the indexed commit, best first", async () => {
    const view = await find("text=database%20failover%20steps&limit=10");
    expect(view.commit).toBe(indexed);
    expect(view.hits.length).toBeGreaterThan(0);
    expect(view.hits.length).toBeLessThanOrEqual(10);
    const ranks = view.hits.map((hit) => hit.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    const top = view.hits[0]!;
    expect(top.node.path).toBe("20-spaces/eng/runbooks/db-failover.md");
    expect(top.breadcrumb.length).toBeGreaterThan(0);
    expect(top.breadcrumb.every((crumb) => typeof crumb.title === "string")).toBe(true);
    expect(top.summary.length).toBeGreaterThan(0);
    for (const hit of view.hits) {
      expect(hit.citation, hit.node.id).toMatch(new RegExp(`^${hit.node.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\d+-\\d+@${indexed}$`));
      if (hit.line !== null) {
        expect(hit.line.number).toBeGreaterThan(0);
        expect(hit.line.text.toLowerCase()).toMatch(/database|failover|steps/);
        const [, start, end] = /:(\d+)-(\d+)@/.exec(hit.citation)!.map(Number);
        expect(hit.line.number).toBeGreaterThanOrEqual(start!);
        expect(hit.line.number).toBeLessThanOrEqual(end!);
      }
    }
    expect(view.hits.some((hit) => hit.line !== null)).toBe(true);
    // The matching line is read from Git: it is what the file holds at that line.
    const withLine = view.hits.find((hit) => hit.line !== null)!;
    const file = (await readFile(join(work, withLine.node.path), "utf8")).split("\n");
    expect(file[withLine.line!.number - 1]!.trim()).toContain(withLine.line!.text.slice(0, 40).trim());
  });

  it("takes limit up to 20, defaulting to 10, and odd syntax never fails", async () => {
    expect((await find("text=the")).hits.length).toBeLessThanOrEqual(10);
    expect((await find("text=service&limit=3")).hits).toHaveLength(3);
    expect((await find("text=service&limit=20")).hits.length).toBeLessThanOrEqual(20);
    for (const text of ['"unbalanced quote', "failover OR", "-", "!!!", "(((", "a & b | c", "failover -runbook", "'", "%00", "\\", "*:*"]) {
      const response = await search(reader, `text=${encodeURIComponent(text)}`);
      expect(response.status, text).toBe(200);
    }
    // A phrase in quotes and a word to leave out are understood.
    const phrase = await find(`text=${encodeURIComponent('"carry over"')}`);
    expect(phrase.hits.length).toBeGreaterThan(0);
    expect(phrase.hits.every((hit) => hit.node.path.length > 0)).toBe(true);
    const without = await find(`text=${encodeURIComponent("leave -carry")}`);
    expect(without.hits.some((hit) => hit.line?.text.toLowerCase().includes("carry"))).toBe(false);
  });

  it("narrows to a space or a label, and the two together", async () => {
    const hr = await find("text=policy&space=hr&limit=20");
    expect(hr.hits.length).toBeGreaterThan(0);
    expect(hr.hits.every((hit) => hit.node.path.startsWith("20-spaces/hr/"))).toBe(true);
    const sev1 = await find("text=database&label=sev1&limit=20");
    expect(sev1.hits.length).toBeGreaterThan(0);
    expect(new Set(sev1.hits.map((hit) => hit.node.path))).toEqual(new Set(["20-spaces/eng/runbooks/db-failover.md"]));
    const both = await find("text=policy&space=ENG&label=sev1&limit=20");
    expect(both.hits.every((hit) => hit.node.path.startsWith("20-spaces/eng/"))).toBe(true);
    expect((await find("text=policy&space=ZZ9&limit=20")).hits).toEqual([]);
  });

  it("leaves archived pages and templates out and counts them, and brings them back when asked", async () => {
    const hidden = await find("text=use%20postgres%20services&limit=20");
    expect(hidden.hits.some((hit) => hit.node.path === "20-spaces/eng/decisions/0001-use-postgres.md")).toBe(false);
    expect(hidden.leftOut.archived).toBeGreaterThanOrEqual(1);
    const shown = await find("text=use%20postgres%20services&archived=true&limit=20");
    expect(shown.hits.some((hit) => hit.node.path === "20-spaces/eng/decisions/0001-use-postgres.md")).toBe(true);
    expect(shown.leftOut).toEqual({ archived: 0, templates: 0 });
    const templates = await find("text=decision%20record&limit=20");
    expect(templates.hits.some((hit) => hit.node.path.includes("/_templates/"))).toBe(false);
    expect(templates.leftOut.templates).toBeGreaterThanOrEqual(1);
    expect((await find("text=decision%20record&archived=true&limit=20")).hits.some((hit) => hit.node.path.includes("/_templates/"))).toBe(true);
  });

  it("never returns what is under restricted/ or _generated/", async () => {
    for (const archived of ["", "&archived=true"]) {
      const view = await find(`text=zebrafish${archived}&limit=20`);
      expect(view.hits).toEqual([]);
    }
    const all = await find("text=the%20and%20for&archived=true&limit=20");
    expect(all.hits.some((hit) => /^(restricted|_generated)\//.test(hit.node.path))).toBe(false);
  });

  it("needs Project Access, administrators included", async () => {
    const { client: outsider } = await memberClient(app, admin, "outsider-o", ["user"], []);
    await app.db.query("delete from admin.project_access where project_id = 'shop' and user_id = $1", [await currentUserId(admin)]);
    for (const client of [outsider, admin]) expect((await search(client, "text=failover")).status).toBe(403);
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
    expect((await search(admin, "text=failover")).status).toBe(200);
  });

  it("is not offered to the member API or the MCP bridge", async () => {
    const files = (await Promise.all(SOURCES.map((dir) => walk(dir).catch(() => [] as string[])))).flat().filter((file) => /\.(ts|tsx|json|md)$/.test(file) && !/[\\/](test|dist|node_modules)[\\/]/.test(file));
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) if (/brain_search|brain\/search/.test(await readFile(file, "utf8"))) offenders.push(file);
    expect(offenders).toEqual([]);
  });
});
