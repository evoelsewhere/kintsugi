// The Brain (ADR-0091) through the API: a manager chooses the branch and the worker builds the tree, then the portal
// and a member's token read it — a level of the tree, a node's text with its citation, a lookup and a search. The
// mirror is a real clone of a fixture repository; the build is the worker's own function, run in-process.

import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrainBacklinksView, BrainBrokenView, BrainChangesView, BrainGrepView, BrainLookupView, BrainReadView, BrainStatusView, BrainTreeView } from "@kintsugi/domain";
import { CheckoutStorage, cloneMirror } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { RepositoryStore } from "@kintsugi/orchestrator";
import { indexBrain } from "@kintsugi/orchestrator/brain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../../src/common/domain/ids.js";
import { hashToken } from "../../src/common/security/token-hash.js";
import { MEMBER_TOKEN_PREFIX } from "../../src/modules/core/auth/application/member-token.service.js";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../support/app.js";

const SPEC = [
  "# Calculate tax",
  "",
  "How the batch computes the tax of an invoice line.",
  "",
  "## Business rules",
  "",
  "### RULE-INV01-0001: Late fee",
  "",
  "A late fee of 2% applies after 30 days.",
  "",
  "## Data",
  "",
  "See [the invoice line](data-objects.md#invoice-line).",
].join("\n");

const bearer = (token: string) => ({ csrf: false, headers: { authorization: `Bearer ${token}` } });

describe.skipIf(!hasDatabase)("brain (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let remote: GitHttpServer;
  let dataDir: string;
  let token: string;
  let pool: pg.Pool;
  let firstCommit: string;
  let secondCommit: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];
  const build = () =>
    indexBrain({ pool, repositories: new RepositoryStore(pool), storage: new CheckoutStorage(dataDir), log: () => undefined }, "shop");

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-brain-api-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    firstCommit = await remote.commitFiles("docs", [
      { path: "01-standards/README.md", content: "# Standards\n\nHow this project names and reviews code.\n" },
      { path: "10-applications/web/01-legacy/billing/tax/spec.md", content: SPEC },
      { path: "10-applications/web/01-legacy/billing/tax/data-objects.md", content: "## Invoice line\n\nAmounts round half up.\n" },
      { path: "20-spaces/team/README.md", content: "---\nkey: TEAM\nlabels: [team]\n---\n\n# Team\n\nThe team's space.\n" },
      { path: "20-spaces/team/db.md", content: "---\nlabels:\n  - Runbook\n  - sev1\n---\n\n# Database\n\nFail over the database.\n" },
      { path: "20-spaces/team/cache.md", content: "---\nlabels: [runbook]\n---\n\n# Cache\n\nFlush the cache.\n" },
    ]);
    secondCommit = await remote.commit("docs", "10-applications/web/01-legacy/billing/tax/data-objects.md", "## Invoice line\n\nAmounts round half up.\nTotals round once per line.\n");
    await remote.commit("docs", "01-standards/README.md", "# Standards (next)\n", "release");
    await cloneMirror(`${remote.baseUrl}/docs.git`, new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    app = await startTestApp();
    pool = new pg.Pool({ connectionString: app.db.url, max: 2 });
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', $1, 'none')", [remote.baseUrl]);
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', $1, 'main')", [`${remote.baseUrl}/docs.git`]);
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);

    await app.db.query("insert into core.role_permission (role_id, permission_code) values ('admin', 'member.read') on conflict do nothing");
    const adminId = (await admin.get<{ id: string }>("/auth/me")).body.data!.id;
    expect((await admin.request("PUT", `/admin/project-access/shop/${adminId}`, { body: {} })).status).toBe(204);
    token = MEMBER_TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const tokenId = newId();
    await app.db.query("insert into core.member_token (id, user_id, name, token_hash, expires_at) values ($1, $2, 'test', $3, $4)", [tokenId, adminId, hashToken(token), new Date(Date.now() + 60_000)]);
    await app.db.query("insert into core.member_token_project (token_id, project_id) values ($1, 'shop')", [tokenId]);
  }, 180_000);
  afterAll(async () => {
    await pool?.end();
    await app?.close();
    await remote?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("is not built until a manager turns it on, and only a manager can", async () => {
    const status = await admin.get<BrainStatusView>("/projects/shop/brain");
    expect(status.body.data).toMatchObject({ available: true, configured: false, state: "not-built", branch: "main", defaultBranch: "main", branches: ["main", "release"] });
    expect((await admin.get("/projects/shop/brain/tree")).status).toBe(409);
    const { client } = await memberClient(app, admin, "reader", ["user"], ["shop"]);
    expect((await client.get("/projects/shop/brain")).status).toBe(200);
    expect((await client.request("PUT", "/projects/shop/brain", { body: { enabled: true } })).status).toBe(403);
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true, branch: "kintsugi/x" } })).status).toBe(400);
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true, branch: "nope" } })).status).toBe(400);
  });

  it("builds the chosen branch and serves its tree with summaries", async () => {
    const configured = await admin.request<BrainStatusView>("PUT", "/projects/shop/brain", { body: { enabled: true } });
    expect(configured.status).toBe(200);
    expect(configured.body.data).toMatchObject({ configured: true, enabled: true, state: "queued" });
    expect(await build()).toMatchObject({ status: "built", documents: 7 });

    const status = (await admin.get<BrainStatusView>("/projects/shop/brain")).body.data!;
    expect(status).toMatchObject({ state: "ready", documents: 7, identifiers: 1 });
    expect(status.commit).toBe(status.tip);

    const root = (await admin.get<BrainTreeView>("/projects/shop/brain/tree?depth=2")).body.data!;
    expect(root.node).toMatchObject({ id: "/", kind: "root", title: "Shop · main" });
    expect(root.children.map((child) => child.id)).toEqual(["01-standards/", "10-applications/", "20-spaces/", "README.md"]);
    expect(root.children[0]).toMatchObject({ summary: "How this project names and reviews code.", summarySource: "readme" });
    expect(root.children[1]?.nodes?.map((node) => node.id)).toEqual(["10-applications/web/"]);
  });

  it("reads a node with its citation, breadcrumb and links, in bounded parts", async () => {
    const read = (await admin.get<BrainReadView>(`/projects/shop/brain/node?node=${encodeURIComponent("10-applications/web/01-legacy/billing/tax/spec.md#data")}`)).body.data!;
    expect(read.text).toBe("## Data\n\nSee [the invoice line](data-objects.md#invoice-line).");
    expect(read.citation).toMatchObject({ path: "10-applications/web/01-legacy/billing/tax/spec.md", lineStart: 11, lineEnd: 13, commit: read.commit });
    expect(read.breadcrumb.map((crumb) => crumb.title)).toEqual(["Shop · main", "10-applications", "web", "01-legacy", "billing", "tax", "Calculate tax"]);
    expect(read.outgoing.map((node) => node.id)).toEqual(["10-applications/web/01-legacy/billing/tax/data-objects.md#invoice-line"]);

    const member = await new Client(app).request<BrainReadView>(
      "GET",
      `/member/v1/brain/read?projectId=shop&node=${encodeURIComponent("10-applications/web/01-legacy/billing/tax/spec.md")}&scope=node`,
      bearer(token),
    );
    expect(member.status).toBe(200);
    // A member's read numbers its lines, so the agent cites the lines it used; the portal's read is the text as written.
    expect(member.body.data).toMatchObject({ scope: "node", lineNumbers: true, text: "1\t# Calculate tax\n2\t\n3\tHow the batch computes the tax of an invoice line.\n4\t" });
    expect(read.lineNumbers).toBe(false);
    expect(member.body.data?.node).not.toHaveProperty("parentId");
    expect(member.body.data?.children.map((node) => node.title)).toEqual(["Business rules", "Data"]);
  });

  it("looks up an id or a path and finds the nodes that hold a text", async () => {
    const lookup = (await admin.get<BrainLookupView>("/projects/shop/brain/lookup?q=RULE-INV01-0001")).body.data!;
    expect(lookup.matches.map((node) => [node.id, node.kind])).toEqual([["10-applications/web/01-legacy/billing/tax/spec.md#RULE-INV01-0001", "card"]]);
    const byPath = (await admin.get<BrainLookupView>("/projects/shop/brain/lookup?q=01-standards")).body.data!;
    expect(byPath.matches.map((node) => node.id)).toEqual(["01-standards/"]);

    // The pages that carry a label or are in a space, by path; an unknown one is an empty list and a malformed one a 400.
    const byLabel = (await admin.get<BrainLookupView>("/projects/shop/brain/lookup?q=label:Runbook")).body.data!;
    expect(byLabel.matches.map((node) => node.id)).toEqual(["20-spaces/team/cache.md", "20-spaces/team/db.md"]);
    expect(byLabel.matches[0]?.breadcrumb.at(-1)?.title).toBe("team");
    const bySpace = (await admin.get<BrainLookupView>("/projects/shop/brain/lookup?q=space:team")).body.data!;
    expect(bySpace.matches.map((node) => node.id)).toEqual(["20-spaces/team/README.md", "20-spaces/team/cache.md", "20-spaces/team/db.md"]);
    expect((await admin.get<BrainLookupView>("/projects/shop/brain/lookup?q=label:nothing")).body.data?.matches).toEqual([]);
    expect((await admin.get("/projects/shop/brain/lookup?q=label:")).status).toBe(400);
    expect((await admin.get(`/projects/shop/brain/lookup?q=label:${"x".repeat(65)}`)).status).toBe(400);
    expect((await admin.get("/projects/shop/brain/lookup?q=label:!!")).status).toBe(400);
    const memberLabel = await new Client(app).request<BrainLookupView>("GET", "/member/v1/brain/lookup?projectId=shop&query=label:sev1", bearer(token));
    expect(memberLabel.body.data?.matches.map((node) => node.id)).toEqual(["20-spaces/team/db.md"]);
    expect(memberLabel.body.data?.matches[0]).not.toHaveProperty("labels");
    // A client that names page-attributes (any case, among other names) gets the page's labels and space; one whose header
    // is unknown, empty or far too long gets the version 1 shape and never an error (P2-020).
    const asking = (value: string) => ({ csrf: false, headers: { authorization: `Bearer ${token}`, "kintsugi-member-features": value } });
    const withAttributes = await new Client(app).request<BrainLookupView>("GET", "/member/v1/brain/lookup?projectId=shop&query=space:team", asking("future-thing, Page-Attributes"));
    expect(withAttributes.status).toBe(200);
    expect(withAttributes.body.data?.matches[0]).toMatchObject({ id: "20-spaces/team/README.md", space: "TEAM", labels: expect.any(Array) });
    for (const value of ["future-thing", "", "x".repeat(500)]) {
      const plain = await new Client(app).request<BrainLookupView>("GET", "/member/v1/brain/lookup?projectId=shop&query=space:team", asking(value));
      expect(plain.status, value.slice(0, 20)).toBe(200);
      expect(plain.body.data?.matches[0]).not.toHaveProperty("space");
    }

    const grep = await new Client(app).request<BrainGrepView>("GET", "/member/v1/brain/grep?projectId=shop&text=late%20FEE", bearer(token));
    expect(grep.status).toBe(200);
    expect(grep.body.data?.matches.map((match) => [match.node.id, match.line])).toEqual([
      ["10-applications/web/01-legacy/billing/tax/spec.md#RULE-INV01-0001", 7],
      ["10-applications/web/01-legacy/billing/tax/spec.md#RULE-INV01-0001", 9],
    ]);
    const scoped = (await admin.get<BrainGrepView>(`/projects/shop/brain/grep?text=round&under=${encodeURIComponent("01-standards/")}`)).body.data!;
    expect(scoped.matches).toEqual([]);
    // A space or a label limits the search to those pages (both: the pages with both), in any case.
    const grepOf = async (query: string) => (await admin.get<BrainGrepView>(`/projects/shop/brain/grep?${query}`)).body.data!;
    const inSpace = await grepOf("text=the&space=Team");
    expect(inSpace).toMatchObject({ space: "TEAM", label: null });
    expect(inSpace.matches.map((match) => match.node.path)).toEqual(["20-spaces/team/README.md", "20-spaces/team/cache.md", "20-spaces/team/db.md"]);
    expect((await grepOf("text=the")).matches.length).toBeGreaterThan(inSpace.matches.length);
    const labelled = await grepOf("text=the&label=Runbook");
    expect(labelled).toMatchObject({ space: null, label: "runbook" });
    expect(labelled.matches.map((match) => match.node.path)).toEqual(["20-spaces/team/cache.md", "20-spaces/team/db.md"]);
    expect((await grepOf("text=the&space=team&label=sev1")).matches.map((match) => match.node.path)).toEqual(["20-spaces/team/db.md"]);
    expect((await grepOf("text=the&space=nothing&label=sev1")).matches).toEqual([]);
    expect((await grepOf("text=the&label=nothing")).matches).toEqual([]);
    expect((await admin.get("/projects/shop/brain/grep?text=the&label=!!")).status).toBe(400);
    expect((await admin.get("/projects/shop/brain/grep?text=the&space=E")).status).toBe(400);
    expect((await admin.get("/projects/shop/brain/grep?text=the&space=ENG-1")).status).toBe(400);
    const { client: stranger } = await memberClient(app, admin, "stranger", ["user"], []);
    expect((await stranger.get("/projects/shop/brain/grep?text=the&space=team")).status).toBe(403);
    const caseSensitive = (await admin.get<BrainGrepView>("/projects/shop/brain/grep?text=late%20FEE&ignoreCase=false")).body.data!;
    expect(caseSensitive.matches).toEqual([]);
    // Every word on one line, in any order; a quoted text is one exact phrase.
    const words = (await admin.get<BrainGrepView>(`/projects/shop/brain/grep?text=${encodeURIComponent("fee late")}`)).body.data!;
    expect(words.matches.map((match) => match.line)).toEqual([7, 9]);
    const phrase = (await admin.get<BrainGrepView>(`/projects/shop/brain/grep?text=${encodeURIComponent('"fee late"')}`)).body.data!;
    expect(phrase.matches).toEqual([]);
  });

  it("says what changed since an earlier commit, by section, and when each document last changed", async () => {
    const changes = (await admin.get<BrainChangesView>(`/projects/shop/brain/changes?since=${firstCommit.slice(0, 12)}`)).body.data!;
    expect(changes).toMatchObject({ since: firstCommit, commit: secondCommit, linesKnown: true, truncated: false });
    expect(changes.files.map((file) => [file.path, file.status, file.added, file.removed, file.nodes.map((node) => node.id)])).toEqual([
      ["10-applications/web/01-legacy/billing/tax/data-objects.md", "modified", 1, 0, ["10-applications/web/01-legacy/billing/tax/data-objects.md#invoice-line"]],
    ]);
    const elsewhere = await new Client(app).request<BrainChangesView>(
      "GET",
      `/member/v1/brain/changes?projectId=shop&since=${firstCommit}&under=${encodeURIComponent("01-standards/")}`,
      bearer(token),
    );
    expect(elsewhere.status).toBe(200);
    expect(elsewhere.body.data?.files).toEqual([]);
    expect((await admin.get(`/projects/shop/brain/changes?since=${"f".repeat(40)}`)).status).toBe(404);
    expect((await admin.get("/projects/shop/brain/changes?since=not-a-commit")).status).toBe(400);

    const changed = (await admin.get<BrainReadView>(`/projects/shop/brain/node?node=${encodeURIComponent("10-applications/web/01-legacy/billing/tax/data-objects.md")}`)).body.data!;
    expect(changed.node.changed).toMatchObject({ commit: secondCommit, subject: expect.any(String) });
    const untouched = (await admin.get<BrainReadView>(`/projects/shop/brain/node?node=${encodeURIComponent("10-applications/web/01-legacy/billing/tax/spec.md")}`)).body.data!;
    expect(untouched.node.changed?.commit).toBe(firstCommit);
    const root = (await admin.get<BrainTreeView>("/projects/shop/brain/tree")).body.data!;
    expect(root.node.changed?.commit).toBe(secondCommit);
  });

  it("lists the broken links the build stored, for readers with Project Access only", async () => {
    // The column is written by the build (a later ticket); the route serves what is there, and nothing before a build.
    expect((await admin.get<BrainBrokenView>("/projects/shop/brain/broken")).body.data).toMatchObject({ links: [], truncated: false, branch: "main" });
    await app.db.query("update knowledge.brain_source set broken = $1::jsonb where project_id = 'shop'", [JSON.stringify([{ from: "01-standards/README.md", target: "gone.md" }, { from: "20-spaces/team/db.md", target: "../missing/page.md" }])]);
    const broken = (await admin.get<BrainBrokenView>("/projects/shop/brain/broken")).body.data!;
    expect(broken).toMatchObject({ projectId: "shop", truncated: false });
    expect(broken.commit).toBe((await admin.get<BrainStatusView>("/projects/shop/brain")).body.data?.commit);
    expect(broken.links).toEqual([{ from: "01-standards/README.md", target: "gone.md" }, { from: "20-spaces/team/db.md", target: "../missing/page.md" }]);
    // No Project Access, administrators included: 403.
    const { client: outsider } = await memberClient(app, admin, "broken-outsider", ["admin"], []);
    expect((await outsider.get("/projects/shop/brain/broken")).status).toBe(403);
    await app.db.query("update knowledge.brain_source set broken = '[]'::jsonb where project_id = 'shop'");
  });

  it("lists the pages that link to a page, a heading or a card, in windows, for readers with Project Access only", async () => {
    const dataObjects = "10-applications/web/01-legacy/billing/tax/data-objects.md";
    const spec = "10-applications/web/01-legacy/billing/tax/spec.md";
    const backlinks = async (query: string) => (await admin.get<BrainBacklinksView>(`/projects/shop/brain/backlinks?${query}`)).body.data!;
    // The spec links to a heading of data-objects.md: the page's backlinks have it, `incoming` of the page does not.
    const page = await backlinks(`node=${encodeURIComponent(dataObjects)}`);
    expect(page).toMatchObject({ total: 1, offset: 0, nextOffset: null, node: { id: dataObjects } });
    expect(page.items.map((item) => [item.node.path, item.target.id, item.linkKind])).toEqual([[spec, `${dataObjects}#invoice-line`, "link"]]);
    const read = (await admin.get<BrainReadView>(`/projects/shop/brain/node?node=${encodeURIComponent(dataObjects)}&scope=node`)).body.data!;
    expect(read.incomingTotal).toBe(0);
    // A member's agent asks the same question (P2-025): without the features header the nodes are those of version 1, with
    // it they carry their attributes, and a node that is not there is the same refusal as for the other member reads.
    const memberBacklinks = (query: string, headers: Record<string, string> = {}) =>
      new Client(app).request<{ node: Record<string, unknown>; items: Array<{ node: Record<string, unknown> }>; total: number; nextOffset: number | null; commit: string }>(
        "GET",
        `/member/v1/brain/backlinks?projectId=shop&${query}`,
        { csrf: false, headers: { authorization: `Bearer ${token}`, ...headers } },
      );
    const plain = await memberBacklinks(`node=${encodeURIComponent(dataObjects)}`);
    expect(plain.status).toBe(200);
    expect(plain.body.data).toMatchObject({ total: 1, nextOffset: null, commit: page.commit });
    expect(plain.body.data?.items[0]?.node).toMatchObject({ path: spec });
    for (const field of ["labels", "space", "status", "owner", "template", "parentId"]) expect(plain.body.data?.items[0]?.node, field).not.toHaveProperty(field);
    const asking = await memberBacklinks(`node=${encodeURIComponent(dataObjects)}`, { "kintsugi-member-features": "page-attributes" });
    expect(asking.body.data?.items[0]?.node).toMatchObject({ path: spec, labels: expect.any(Array), template: false });
    expect((await memberBacklinks("node=nothing.md")).status).toBe(404);
    // The heading has the same backlink; a page nobody links to has none; links inside a page are not backlinks.
    expect((await backlinks(`node=${encodeURIComponent(`${dataObjects}#invoice-line`)}`)).items.map((item) => item.node.path)).toEqual([spec]);
    expect((await backlinks(`node=${encodeURIComponent(spec)}`)).total).toBe(0);

    // Twenty-five more linking pages: windows of 20, then the rest, totals matching.
    await app.db.query(
      `insert into knowledge.brain_node
         select (jsonb_populate_record(null::knowledge.brain_node, to_jsonb(n) || jsonb_build_object('id', 'extra/p' || lpad(g::text, 2, '0') || '.md', 'path', 'extra/p' || lpad(g::text, 2, '0') || '.md', 'parent_id', null))).*
           from knowledge.brain_node n, generate_series(1, 25) g where n.project_id = 'shop' and n.id = $1`,
      [spec],
    );
    await app.db.query("insert into knowledge.brain_link (project_id, from_id, to_id, kind) select 'shop', 'extra/p' || lpad(g::text, 2, '0') || '.md', $1, 'link' from generate_series(1, 25) g", [dataObjects]);
    try {
      const first = await backlinks(`node=${encodeURIComponent(dataObjects)}&limit=20`);
      expect(first).toMatchObject({ total: 26, offset: 0, nextOffset: 20 });
      expect(first.items).toHaveLength(20);
      const second = await backlinks(`node=${encodeURIComponent(dataObjects)}&limit=20&offset=20`);
      expect(second).toMatchObject({ total: 26, offset: 20, nextOffset: null });
      expect(second.items).toHaveLength(6);
      const paths = [...first.items, ...second.items].map((item) => item.node.path);
      expect(new Set(paths).size).toBe(26);
      expect(paths).toEqual([...paths].sort());
      expect((await admin.get(`/projects/shop/brain/backlinks?node=${encodeURIComponent(dataObjects)}&limit=101`)).status).toBe(400);
      const memberFirst = await memberBacklinks(`node=${encodeURIComponent(dataObjects)}&limit=20`);
      const memberSecond = await memberBacklinks(`node=${encodeURIComponent(dataObjects)}&limit=20&offset=${memberFirst.body.data?.nextOffset}`);
      expect([memberFirst.body.data?.items.length, memberFirst.body.data?.total, memberSecond.body.data?.items.length, memberSecond.body.data?.nextOffset]).toEqual([20, 26, 6, null]);
    } finally {
      await app.db.query("delete from knowledge.brain_link where project_id = 'shop' and from_id like 'extra/%'");
      await app.db.query("delete from knowledge.brain_node where project_id = 'shop' and path like 'extra/%'");
    }

    expect((await admin.get("/projects/shop/brain/backlinks?node=10-applications%2F")).status).toBe(400);
    expect((await admin.get("/projects/shop/brain/backlinks?node=nothing.md")).status).toBe(404);
    const { client: outsider } = await memberClient(app, admin, "backlinks-outsider", ["admin"], []);
    expect((await outsider.get(`/projects/shop/brain/backlinks?node=${encodeURIComponent(dataObjects)}`)).status).toBe(403);
  });

  it("follows another branch and turns off", async () => {
    await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true, branch: "release" } });
    await build();
    const root = (await admin.get<BrainTreeView>("/projects/shop/brain/tree?node=01-standards%2F")).body.data!;
    expect(root.branch).toBe("release");
    expect(root.children[0]).toMatchObject({ title: "Standards (next)" });
    expect((await admin.request<BrainStatusView>("POST", "/projects/shop/brain/rebuild")).status).toBe(202);
    await admin.request("PUT", "/projects/shop/brain", { body: { enabled: false } });
    expect((await admin.get<BrainStatusView>("/projects/shop/brain")).body.data?.state).toBe("off");
    expect((await new Client(app).request("GET", "/member/v1/brain/tree?projectId=shop", bearer(token))).status).toBe(409);
  });

  it("turns the wiki on for the default branch, keeps the Brain there and lets it go again", async () => {
    // wiki.manage and Project Access are both needed: administrators included.
    const { client: reader } = await memberClient(app, admin, "wiki-reader", ["user"], ["shop"]);
    expect((await reader.request("PUT", "/projects/shop/wiki", { body: { enabled: true } })).status).toBe(403);
    await subRole(admin, "wiki-manager", ["wiki.manage"]);
    const { client: stranger } = await memberClient(app, admin, "wiki-stranger", ["user", "wiki-manager"], []);
    expect((await stranger.request("PUT", "/projects/shop/wiki", { body: { enabled: true } })).status).toBe(403);
    const { client: otherAdmin } = await memberClient(app, admin, "wiki-admin", ["admin"], []);
    expect((await otherAdmin.request("PUT", "/projects/shop/wiki", { body: { enabled: true } })).status).toBe(403);
    expect((await admin.request("PUT", "/projects/shop/wiki", { body: { enabled: "yes" } })).status).toBe(400);
    expect((await admin.get<BrainStatusView>("/projects/shop/brain")).body.data).toMatchObject({ wiki: false, enabled: false });

    // Wiki off: the branch is chosen as before (the Brain is off here and sits on the branch "release").
    const on = await admin.request<BrainStatusView>("PUT", "/projects/shop/wiki", { body: { enabled: true } });
    expect(on.status).toBe(200);
    expect(on.body.data).toMatchObject({ wiki: true, enabled: true, branch: "main", state: "queued" });
    expect(await build()).toMatchObject({ status: "built" });
    const audit = await app.db.query<{ detail: Record<string, unknown> }>("select detail from governance.audit_event where action = 'wiki.switch' order by id");
    expect(audit.rows.map((row) => ({ enabled: row.detail["enabled"], branch: row.detail["branch"] }))).toEqual([{ enabled: true, branch: "main" }]);

    // Switching on again changes and queues nothing.
    expect((await admin.request<BrainStatusView>("PUT", "/projects/shop/wiki", { body: { enabled: true } })).body.data).toMatchObject({ wiki: true, state: "ready" });
    expect((await app.db.query("select 1 from governance.audit_event where action = 'wiki.switch'")).rowCount).toBe(1);

    // The Brain of a wiki project follows the default branch and cannot be turned off.
    const moved = await admin.request<{ message: string }>("PUT", "/projects/shop/brain", { body: { enabled: true, branch: "release" } });
    expect(moved.status).toBe(409);
    expect(moved.body).toMatchObject({ message: "A wiki project's Brain follows the default branch" });
    const off = await admin.request("PUT", "/projects/shop/brain", { body: { enabled: false } });
    expect(off.status).toBe(409);
    expect((await admin.get<BrainStatusView>("/projects/shop/brain")).body.data).toMatchObject({ wiki: true, enabled: true, branch: "main", state: "ready" });
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true, branch: "main" } })).status).toBe(200);
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true } })).status).toBe(200);

    // Switching the wiki off leaves the Brain as it is and frees the branch.
    expect((await admin.request<BrainStatusView>("PUT", "/projects/shop/wiki", { body: { enabled: false } })).body.data).toMatchObject({ wiki: false, enabled: true, branch: "main" });
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true, branch: "release" } })).status).toBe(200);
    expect((await admin.get<BrainStatusView>("/projects/shop/brain")).body.data).toMatchObject({ wiki: false, branch: "release" });
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: false } })).status).toBe(200);
  });

  it("moves a wiki project's Brain when the repository's default branch changes, and leaves the others", async () => {
    const setDefault = (branch: string) => admin.request("PATCH", "/admin/git-repositories/docs", { body: { defaultBranch: branch } });
    const brain = async () => (await admin.get<BrainStatusView>("/projects/shop/brain")).body.data!;
    // Wiki off: the Brain keeps the branch it was given, whatever the repository's default branch does.
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true, branch: "main" } })).status).toBe(200);
    expect((await setDefault("release")).status).toBe(200);
    expect(await brain()).toMatchObject({ wiki: false, branch: "main", defaultBranch: "release" });
    expect((await setDefault("main")).status).toBe(200);

    // Wiki on: the Brain follows, is queued at once (the mirror has the branch), and the change is audited.
    expect((await admin.request("PUT", "/projects/shop/wiki", { body: { enabled: true } })).status).toBe(200);
    expect(await build()).toMatchObject({ status: "built" });
    expect(await brain()).toMatchObject({ wiki: true, branch: "main", state: "ready" });
    expect((await setDefault("release")).status).toBe(200);
    expect(await brain()).toMatchObject({ wiki: true, enabled: true, branch: "release", defaultBranch: "release", state: "queued" });
    expect((await app.db.query("select state, requested_at > now() - interval '1 minute' as fresh from knowledge.brain_source where project_id = 'shop'")).rows[0]).toMatchObject({ state: "queued", fresh: true });
    const audit = await app.db.query<{ detail: Record<string, unknown> }>("select detail from governance.audit_event where action = 'brain.configure' and detail->>'reason' = 'default-branch'");
    expect(audit.rows.map((row) => row.detail)).toEqual([expect.objectContaining({ branch: "release", enabled: true, wiki: true })]);
    expect(await build()).toMatchObject({ status: "built" });
    expect((await admin.get<BrainTreeView>("/projects/shop/brain/tree?node=01-standards%2F")).body.data?.children[0]).toMatchObject({ title: "Standards (next)" });

    // Setting the branch it already has changes nothing; wiki off again, the Brain stays where it is.
    expect((await setDefault("release")).status).toBe(200);
    expect(await brain()).toMatchObject({ branch: "release", state: "ready" });
    expect((await admin.request("PUT", "/projects/shop/wiki", { body: { enabled: false } })).status).toBe(200);
    expect((await setDefault("main")).status).toBe(200);
    expect(await brain()).toMatchObject({ wiki: false, branch: "release", defaultBranch: "main" });
  });
});
