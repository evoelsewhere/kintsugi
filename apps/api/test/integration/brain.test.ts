// The Brain (ADR-0091) through the API: a manager chooses the branch and the worker builds the tree, then the portal
// and a member's token read it — a level of the tree, a node's text with its citation, a lookup and a search. The
// mirror is a real clone of a fixture repository; the build is the worker's own function, run in-process.

import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrainGrepView, BrainLookupView, BrainReadView, BrainStatusView, BrainTreeView } from "@kintsugi/domain";
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
import { Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

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
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];
  const build = () =>
    indexBrain({ pool, repositories: new RepositoryStore(pool), storage: new CheckoutStorage(dataDir), log: () => undefined }, "shop");

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-brain-api-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    await remote.commitFiles("docs", [
      { path: "01-standards/README.md", content: "# Standards\n\nHow this project names and reviews code.\n" },
      { path: "10-applications/web/01-legacy/billing/tax/spec.md", content: SPEC },
      { path: "10-applications/web/01-legacy/billing/tax/data-objects.md", content: "## Invoice line\n\nAmounts round half up.\n" },
    ]);
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
    const { client } = await memberClient(app, admin, "reader", ["user"]);
    expect((await client.get("/projects/shop/brain")).status).toBe(200);
    expect((await client.request("PUT", "/projects/shop/brain", { body: { enabled: true } })).status).toBe(403);
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true, branch: "kintsugi/x" } })).status).toBe(400);
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true, branch: "nope" } })).status).toBe(400);
  });

  it("builds the chosen branch and serves its tree with summaries", async () => {
    const configured = await admin.request<BrainStatusView>("PUT", "/projects/shop/brain", { body: { enabled: true } });
    expect(configured.status).toBe(200);
    expect(configured.body.data).toMatchObject({ configured: true, enabled: true, state: "queued" });
    expect(await build()).toMatchObject({ status: "built", documents: 4 });

    const status = (await admin.get<BrainStatusView>("/projects/shop/brain")).body.data!;
    expect(status).toMatchObject({ state: "ready", documents: 4, identifiers: 1 });
    expect(status.commit).toBe(status.tip);

    const root = (await admin.get<BrainTreeView>("/projects/shop/brain/tree?depth=2")).body.data!;
    expect(root.node).toMatchObject({ id: "/", kind: "root", title: "Shop · main" });
    expect(root.children.map((child) => child.id)).toEqual(["01-standards/", "10-applications/", "README.md"]);
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

    const grep = await new Client(app).request<BrainGrepView>("GET", "/member/v1/brain/grep?projectId=shop&text=late%20FEE", bearer(token));
    expect(grep.status).toBe(200);
    expect(grep.body.data?.matches.map((match) => [match.node.id, match.line])).toEqual([
      ["10-applications/web/01-legacy/billing/tax/spec.md#RULE-INV01-0001", 7],
      ["10-applications/web/01-legacy/billing/tax/spec.md#RULE-INV01-0001", 9],
    ]);
    const scoped = (await admin.get<BrainGrepView>(`/projects/shop/brain/grep?text=round&under=${encodeURIComponent("01-standards/")}`)).body.data!;
    expect(scoped.matches).toEqual([]);
    const caseSensitive = (await admin.get<BrainGrepView>("/projects/shop/brain/grep?text=late%20FEE&ignoreCase=false")).body.data!;
    expect(caseSensitive.matches).toEqual([]);
    // Every word on one line, in any order; a quoted text is one exact phrase.
    const words = (await admin.get<BrainGrepView>(`/projects/shop/brain/grep?text=${encodeURIComponent("fee late")}`)).body.data!;
    expect(words.matches.map((match) => match.line)).toEqual([7, 9]);
    const phrase = (await admin.get<BrainGrepView>(`/projects/shop/brain/grep?text=${encodeURIComponent('"fee late"')}`)).body.data!;
    expect(phrase.matches).toEqual([]);
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
});
