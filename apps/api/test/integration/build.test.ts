// The build view and the review of a member's merge request (ADR-0071): what members recorded for the designed units they
// built (the merge request, its head commit, the counts of their test run), what the review of it found, and the checks before a
// review is queued. The documents are the ones the review stage publishes (front matter a script wrote); the mirror is a real
// bare clone served by a local Git server; the members' records are rows of monitoring.member_activity.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CheckoutStorage, cloneMirror } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogDocuments } from "../support/documents.js";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

const FIXTURES = fileURLToPath(new URL("../../../../packages/agents/builtin/plugins/modernize/scripts/tests/fixtures/design/", import.meta.url));
const fixture = (...parts: string[]): string => readFileSync(join(FIXTURES, ...parts), "utf8");
const filesUnder = (dir: string, prefix = ""): string[] => readdirSync(join(FIXTURES, dir, prefix)).flatMap((name) => (statSync(join(FIXTURES, dir, prefix, name)).isDirectory() ? filesUnder(dir, `${prefix}${name}/`) : [`${prefix}${name}`]));

const MANIFEST = ["schemaVersion: 1", "project:", "  id: shop", "  name: Shop", "document:", "  server: local", "  path: docs", "unitKinds: [screen]", "applications:", "  - id: web", "    repos:", "      - {server: local, path: legacy, role: legacy}", "      - {server: local, path: web-ui, role: target, component: web}", ""].join("\n");
const RULES = ["# Rules", "", "### R-001: Total is computed", "", "### R-002: Rounding", "", "### R-003: Date format", ""].join("\n");
const FUNCTIONS_OK = ["---", 'template: "basic@3"', "---", "# Functions", "", "## Functions", "", "| ID | Function | Priority |", "| --- | --- | --- |", "| F-001 | Compute | high |", "| F-002 | Print | low |", ""].join("\n");
const unitFile = (module: string, unit: string): string => ["---", `id: "web/${module}/${unit}"`, 'application: "web"', `module: "${module}"`, 'kind: "screen"', `title: "${unit}"`, "---", ""].join("\n");
const modernPath = (module: string, unit: string, file: string): string => `10-applications/web/02-modern/${module}/${unit}/${file}`;
const legacyPath = (module: string, unit: string, file: string): string => `10-applications/web/01-legacy/${module}/${unit}/${file}`;

const C1 = "1".repeat(40);
const C2 = "2".repeat(40);
const C3 = "3".repeat(40);
const PR_INVOICE = "https://git.example/org/web-ui/pull/11";
const PR_TAX = "https://git.example/org/web-ui/pull/12";

describe.skipIf(!hasDatabase)("units members build and the review of their merge requests (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let remote: GitHttpServer;
  let dataDir: string;
  let adminId = "";
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const record = (unit: string, kind: string, detail: Record<string, unknown>, at: string, plugin = "modernize"): Promise<unknown> =>
    app.db.query("insert into monitoring.member_activity (id, at, user_id, project_id, plugin_name, harness, kind, summary, detail) values (gen_random_uuid()::text, $1, $2, 'shop', $3, 'claude-code', $4, $5, $6)", [at, adminId, plugin, kind, unit, JSON.stringify(detail)]);

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-build-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    const put = (path: string, text: string): Promise<unknown> => remote.commit("docs", path, text);
    await put("kintsugi.yaml", MANIFEST);
    for (const [path, text] of Object.entries(catalogDocuments("web", [{ id: "billing", name: "Billing" }], ["invoice", "tax", "ledger", "report"].map((unit) => ({ id: `billing/${unit}`, kind: "screen", files: ["legacy/main.c"] }))))) await put(path, text);

    for (const name of filesUnder("sets/basic")) await put(`01-standards/templates/basic/${name}`, fixture("sets", "basic", ...name.split("/")));
    const designed = async (module: string, unit: string): Promise<void> => {
      await put(modernPath(module, unit, "README.md"), unitFile(module, unit));
      await put(legacyPath(module, unit, "rules.md"), RULES);
      await put(legacyPath(module, unit, "understanding.md"), `---\nstatus: understood\ndigest: sha256:${unit}\n---\n`);
      await put(legacyPath(module, unit, "spec.md"), "# Specification\n\n## Gaps and questions\n\nNone.\n");
      await put(modernPath(module, unit, "basic/overview.md"), fixture("designs", "basic-overview-ok.md"));
      await put(modernPath(module, unit, "basic/functions.md"), FUNCTIONS_OK);
    };
    // invoice: reviewed at commit C1, with a blocker.
    await designed("billing", "invoice");
    await put(modernPath("billing", "invoice", "_build/review.md"), ["---", 'unit: "billing/invoice"', 'stage: "review"', 'reviewed: "true"', "blockers: 1", "majors: 0", "minors: 2", `mr: "${PR_INVOICE}"`, `commit: "${C1}"`, "---", "# Review", ""].join("\n"));
    // tax and ledger: designed, built by a member, not reviewed. report: not designed.
    await designed("billing", "tax");
    await designed("billing", "ledger");
    await put(modernPath("customers", "report", "README.md"), unitFile("customers", "report"));
    await put(legacyPath("customers", "report", "rules.md"), RULES);
    await cloneMirror(`${remote.baseUrl}/docs.git`, new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    app = await startTestApp();
    admin = await adminClient(app);
    adminId = (await app.db.query<{ id: string }>("select id from core.app_user where username = 'admin'")).rows[0]!.id;
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', $1, 'none')", [remote.baseUrl]);
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', $1, 'main'), ('legacy', 'local', $2, 'main'), ('web-ui', 'local', $3, 'main')", [
      `${remote.baseUrl}/docs.git`,
      `${remote.baseUrl}/legacy.git`,
      `${remote.baseUrl}/web-ui.git`,
    ]);
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications", { body: { id: "web", name: "Web" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications/web/repositories", { body: { repositoryId: "legacy", role: "legacy" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications/web/repositories", { body: { repositoryId: "web-ui", role: "target", component: "web" } })).status).toBe(201);
    await app.db.query("insert into workflow.job_run (id, project_id, application_id, kind, name, status, inputs, created_at) values ('run-design', 'shop', 'web', 'stage', 'design', 'succeeded', '{}', now() - interval '7 hours')");
    // What members recorded (newest wins): invoice at C1 (the review's commit); tax's test run, then its merge request; one record that is not a build record.
    await record("billing/invoice", "build.mr", { mr: PR_INVOICE, branch: "feature/invoice", commit: C1, cases: 12, failed: 0, canary: "killed" }, "2026-10-20T10:00:00Z");
    await record("billing/tax", "build.test", { cases: 5, failed: 1, canary: "survived" }, "2026-10-21T09:00:00Z");
    await record("billing/tax", "build.mr", { mr: PR_TAX, branch: "feature/tax", commit: C2 }, "2026-10-21T10:00:00Z");
    await record("billing/tax", "result", { mr: "https://elsewhere.example/ignored", commit: C3 }, "2026-10-22T10:00:00Z");
    await record("billing/ledger", "build.mr", { mr: "javascript:alert(1)", commit: C3 }, "2026-10-22T11:00:00Z");
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await remote?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  type Unit = {
    key: string;
    designed: boolean;
    rules: number;
    member?: { mr?: string; branch?: string; commit?: string; cases?: number; failed?: number; canary?: string; username?: string };
    review: { state: string; runId?: string; blockers?: number; majors?: number; minors?: number; stale?: boolean };
  };
  type Overview = { targets: Array<{ repositoryId: string; component?: string }>; units: Unit[]; mergeRequests: Array<{ url: string; branch?: string; commit: string; units: string[]; reviewed: boolean }> };
  type Failure = { message: string; details?: { conflicts?: Array<{ unit: string; reason: string }>; unknown?: string[]; undesigned?: string[]; targets?: string[] } };
  const OVERVIEW = "/projects/shop/applications/web/build";
  const REVIEWS = `${OVERVIEW}/reviews`;
  const unitOf = (view: Overview, key: string): Unit => view.units.find((entry) => entry.key === key)!;

  it("shows each designed unit with what the member recorded and what the review found", async () => {
    const view = (await admin.get<Overview>(OVERVIEW)).body.data!;
    expect(view.targets).toEqual([{ repositoryId: "web-ui", component: "web" }]);
    expect(unitOf(view, "billing/invoice")).toMatchObject({
      designed: true,
      member: { mr: PR_INVOICE, branch: "feature/invoice", commit: C1, cases: 12, failed: 0, canary: "killed", username: "admin" },
      review: { state: "reviewed", blockers: 1, majors: 0, minors: 2 },
    });
    expect(unitOf(view, "billing/invoice").review.stale).toBeUndefined();
    // A merge request takes the numbers of the unit's last test run when it carries none of its own; another kind of record is not a build record.
    expect(unitOf(view, "billing/tax")).toMatchObject({ member: { mr: PR_TAX, commit: C2, cases: 5, failed: 1, canary: "survived" }, review: { state: "none" } });
    // A link that is not http(s) is never shown as one.
    expect(unitOf(view, "billing/ledger").member?.mr).toBeUndefined();
    expect(unitOf(view, "customers/report")).toMatchObject({ designed: false, review: { state: "none" } });
    expect(view.mergeRequests).toEqual([
      { url: PR_INVOICE, branch: "feature/invoice", commit: C1, units: ["billing/invoice"], reviewed: true },
      { url: PR_TAX, branch: "feature/tax", commit: C2, units: ["billing/tax"], reviewed: false },
    ]);
  });

  it("names the member only to a reader who may view member activity", async () => {
    const { client } = await memberClient(app, admin, "build-reader", ["user"]);
    const view = (await client.get<Overview>(OVERVIEW)).body.data!;
    expect(unitOf(view, "billing/invoice").member).toMatchObject({ mr: PR_INVOICE, commit: C1 });
    expect(unitOf(view, "billing/invoice").member?.username).toBeUndefined();
  });

  it("marks a review out of date when the member pushed a newer commit", async () => {
    await record("billing/invoice", "build.mr", { mr: PR_INVOICE, branch: "feature/invoice", commit: C3 }, "2026-10-23T10:00:00Z");
    const view = (await admin.get<Overview>(OVERVIEW)).body.data!;
    expect(unitOf(view, "billing/invoice")).toMatchObject({ member: { commit: C3 }, review: { state: "reviewed", stale: true } });
    expect(view.mergeRequests.find((entry) => entry.commit === C3)).toMatchObject({ units: ["billing/invoice"], reviewed: false });
  });

  it("refuses a review that cannot start: no permission, a bad body, an unknown or undesigned unit, no merge request, several merge requests", async () => {
    const { client } = await memberClient(app, admin, "build-viewer", ["user"]);
    expect((await client.request("POST", REVIEWS, { body: { units: ["billing/tax"] } })).status).toBe(403);
    expect((await admin.request("POST", REVIEWS, { body: {} })).status).toBe(400);
    expect((await admin.request("POST", REVIEWS, { body: { units: ["not a key"] } })).status).toBe(400);
    expect((await admin.request("POST", "/projects/shop/applications/web/stages/review/run")).status).toBe(400);

    const unknown = await admin.request<Failure>("POST", REVIEWS, { body: { units: ["billing/tax", "billing/nope", "customers/report"] } });
    expect(unknown.status).toBe(400);
    expect((unknown.body as unknown as Failure).details).toMatchObject({ unknown: ["billing/nope"], undesigned: ["customers/report"] });
    expect((await admin.request("POST", REVIEWS, { body: { units: ["billing/tax"], target: "legacy" } })).status).toBe(400);

    const none = await admin.request<Failure>("POST", REVIEWS, { body: { units: ["billing/ledger"] } });
    expect(none.status).toBe(409);
    expect((none.body as unknown as Failure).details?.conflicts).toEqual([{ unit: "billing/ledger", reason: expect.stringContaining("no merge request recorded") }]);

    const several = await admin.request<Failure>("POST", REVIEWS, { body: { units: ["billing/invoice", "billing/tax"] } });
    expect(several.status).toBe(409);
    expect((several.body as unknown as Failure).details?.conflicts?.map((conflict) => conflict.unit)).toEqual(["billing/invoice", "billing/tax"]);

  });

  it("queues the review of a merge request pinned to its head commit, shows it as running, and refuses the same unit again", async () => {
    const started = await admin.request<{ id: string; name: string; status: string }>("POST", REVIEWS, { body: { units: ["billing/tax"] } });
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    expect(started.body.data).toMatchObject({ name: "review", status: "queued" });
    const stored = await app.db.query<{ inputs: { scope: unknown; documentsCommit: string }; sources: Array<{ repositoryId: string; role?: string; commit?: string }> }>("select inputs, sources from workflow.job_run where id = $1", [started.body.data!.id]);
    expect(stored.rows[0]?.inputs.scope).toEqual({ items: ["billing/tax"], files: [], target: "web-ui", mr: { url: PR_TAX, commit: C2, branch: "feature/tax", tests: { cases: 5, failed: 1, canary: "survived" } } });
    expect(stored.rows[0]?.inputs.documentsCommit).toMatch(/^[0-9a-f]{40}$/);
    // The target repository is read at the head commit of the merge request, the legacy one at its current commit.
    expect(stored.rows[0]?.sources.find((source) => source.repositoryId === "web-ui")).toMatchObject({ role: "target", commit: C2 });
    expect(stored.rows[0]?.sources.find((source) => source.repositoryId === "legacy")?.commit).toBeUndefined();

    const view = (await admin.get<Overview>(OVERVIEW)).body.data!;
    expect(unitOf(view, "billing/tax").review).toEqual({ state: "running", runId: started.body.data!.id });
    const again = await admin.request<Failure>("POST", REVIEWS, { body: { units: ["billing/tax"] } });
    expect(again.status).toBe(409);
    expect((again.body as unknown as Failure).details?.conflicts).toEqual([{ unit: "billing/tax", reason: "is being reviewed" }]);
    await app.db.query("update workflow.job_run set status = 'cancelled' where id = $1", [started.body.data!.id]);
  });
});
