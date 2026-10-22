// The item catalog with derived item status (ADR-0033): the catalog assess merged on the default
// branch, the understanding records of understood items, and the understand runs the worker records (running,
// in an open pull request, failed, abandoned). The mirror is a real bare clone of a fixture
// repository served by a local Git server.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";
import { catalogDocuments, findingsDocument, understoodUnit } from "../support/documents.js";

/** The catalog assess merged (ADR-0042): an index and one document per module. */
export const CATALOG = catalogDocuments(
  "web",
  [
    { id: "billing", name: "Billing" },
    { id: "customers", name: "Customers" },
  ],
  [
    { id: "billing/invoice", files: ["src/Invoice.java"] },
    { id: "billing/rates", files: ["src/Rates.java"] },
    { id: "billing/tax", files: ["src/Tax.java"] },
    { id: "customers/update", files: ["src/Update.java"] },
    { id: "customers/report", files: ["src/Report.java"] },
    { id: "customers/lookup", files: ["src/Lookup.java"] },
    { id: "customers/gone", files: ["src/Gone.java"], status: "retired" },
  ],
  ["README.md"],
  ["legacy@" + "a".repeat(40), "legacy-data@" + "b".repeat(40)],
  ["src/X.java is claimed by 2 leaves"],
);

/** The checked plan of a planning run (ADR-0041), at the catalog's source commit. */
const PLAN = [
  "---",
  "version: 1",
  'app: "web"',
  `catalogCommit: "${"a".repeat(40)}"`,
  "items: 7",
  "open: 5",
  "batches: 1",
  "planned: 3",
  "---",
  "# Plan to understand web",
  "",
  "Billing first.",
  "",
  "## Batch 1: Billing",
  "",
  "Foundation.",
  "",
  "- **risk:** high",
  "- **loc:** 30",
  "- **high complexity:** 0",
  "- **cohesion:** 1.0",
  "",
  "### Items",
  "",
  "- `billing/invoice`",
  "- `billing/tax`",
  "- `customers/gone`",
  "",
].join("\n");

describe.skipIf(!hasDatabase)("item catalog (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let remote: GitHttpServer;
  let dataDir: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-catalog-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    for (const [path, text] of Object.entries(CATALOG)) await remote.commit("docs", path, text);
    await remote.commit("docs", "10-applications/web/01-legacy/plan.md", PLAN);
    // Understood on main: invoice at the catalog's digest, rates at an older one (stale).
    const invoice = understoodUnit("web", "billing/invoice", {
      digest: "sha256:invoice",
      commit: "b".repeat(40),
      runId: "run-merged",
      rule: { id: "RULE-billing.invoice-1a2b3c4d", name: "Invoice total", source: "src/Invoice.java:3" },
      findings: ["SEC-billing.invoice-01"],
      dependencies: [{ target: "billing/rates" }],
    });
    for (const [path, text] of Object.entries({ ...invoice, ...understoodUnit("web", "billing/rates", { digest: "sha256:old", commit: "b".repeat(40), runId: "run-merged" }) })) await remote.commit("docs", path, text);
    await remote.commit("docs", "10-applications/web/01-legacy/billing/invoice/findings.md", findingsDocument("billing/invoice", [{ id: "SEC-billing.invoice-01", cwe: "CWE-89", severity: "High", source: "src/Invoice.java:9", title: "SQL built from input" }]));
    // The topology the assessment summarised, on main.
    await remote.commit(
      "docs",
      "10-applications/web/01-legacy/topology.md",
      '---\nsystem: "web"\n---\n# Topology of web\n\n## Domains\n\n| Domain | Leaves | Data stores | LOC |\n| --- | --- | --- | --- |\n| Billing | 1 | 0 | 10 |\n\n## Leaves\n\n| Leaf | Name | Kind | Domain | File | LOC | Entry point | Dead end |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| INV | Invoice | module | Billing | src/Invoice.java | 10 | yes |  |\n',
    );
    await remote.commit("docs", "10-applications/web/01-legacy/billing/tax/spec.md", "# Tax\n", "kintsugi/legacy-analyst/run-open");
    await remote.commit("docs", "10-applications/web/01-legacy/customers/report/spec.md", "# Report\n", "kintsugi/legacy-analyst/run-abandoned");
    await cloneMirror(`${remote.baseUrl}/docs.git`, new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', $1, 'none')", [remote.baseUrl]);
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', $1, 'main'), ('legacy', 'local', $2, 'main')", [`${remote.baseUrl}/docs.git`, `${remote.baseUrl}/legacy.git`]);
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications", { body: { id: "web", name: "Web" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications/web/repositories", { body: { repositoryId: "legacy", role: "legacy" } })).status).toBe(201);

    await app.db.query(
      "insert into workflow.document_write (id, project_id, kind, message, status, branch, pr_url) values ('w-open', 'shop', 'job-output', 'Understand web', 'pr-opened', 'kintsugi/legacy-analyst/run-open', 'https://git.example/pr/1'), ('w-abandoned', 'shop', 'job-output', 'Understand web', 'pr-opened', 'kintsugi/legacy-analyst/run-abandoned', null)",
    );
    const scope = (items: string[]): string => JSON.stringify({ scope: { items, files: [] } });
    await app.db.query(
      `insert into workflow.job_run (id, project_id, application_id, kind, name, status, document_write_id, inputs, output_summary, abandoned_at, created_at) values
        ('run-assess', 'shop', 'web', 'stage', 'assess', 'succeeded', null, '{}', null, null, now() - interval '6 hours'),
        ('run-merged', 'shop', 'web', 'stage', 'understand', 'succeeded', null, $1, null, null, now() - interval '5 hours'),
        ('run-open', 'shop', 'web', 'stage', 'understand', 'succeeded', 'w-open', $2, null, null, now() - interval '3 hours'),
        ('run-failed', 'shop', 'web', 'stage', 'understand', 'failed', null, $3, $7, null, now() - interval '2 hours'),
        ('run-abandoned', 'shop', 'web', 'stage', 'understand', 'succeeded', 'w-abandoned', $4, $5, now(), now() - interval '90 minutes'),
        ('run-active', 'shop', 'web', 'stage', 'understand', 'running', null, $6, null, null, now() - interval '1 hour')`,
      [
        scope(["billing/invoice", "billing/rates"]),
        scope(["billing/tax"]),
        scope(["customers/update", "billing/rates"]),
        scope(["customers/report", "customers/lookup"]),
        JSON.stringify({ stage: "understand", steps: [{ id: "specify-item", kind: "agent", status: "failed", key: "customers/lookup" }] }),
        scope(["customers/gone"]),
        JSON.stringify({ stage: "understand", documentsCommit: "c".repeat(40), steps: [] }),
      ],
    );
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await remote?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("serves the catalog with a derived status per item", async () => {
    const { client } = await memberClient(app, admin, "reader", ["user"]);
    const response = await client.get<{
      ref: { ref: string };
      catalog: { modules: unknown[]; unassigned: string[]; ambiguities: string[]; items?: unknown };
      items: Array<{ id: string; status: string; pr?: { runId: string; url?: string }; lastRun?: { id: string }; understood?: { runId?: string } }>;
      counts: Record<string, number>;
    }>("/projects/shop/applications/web/catalog");
    expect(response.status).toBe(200);
    const data = response.body.data!;
    expect(data.ref.ref).toBe("refs/heads/main");
    expect(data.catalog.items).toBeUndefined();
    expect(data.catalog.unassigned).toEqual(["README.md"]);
    expect(data.catalog.ambiguities).toEqual(["src/X.java is claimed by 2 leaves"]);
    const status = Object.fromEntries(data.items.map((entry) => [entry.id, entry.status]));
    expect(status).toEqual({
      "billing/invoice": "understood",
      // Its latest run failed after it was understood; failed outranks stale.
      "billing/rates": "failed",
      "billing/tax": "in-pr",
      "customers/update": "failed",
      // Abandoned pull request: released; the item's own step failed in that run.
      "customers/report": "not-analysed",
      "customers/lookup": "failed",
      // Retired stands beside the run states, even with a run touching it.
      "customers/gone": "retired",
    });
    const byId = new Map(data.items.map((entry) => [entry.id, entry]));
    expect(data.items.every((entry) => (entry as { assetClass?: string }).assetClass === "code")).toBe(true);
    expect(byId.get("billing/tax")?.pr).toEqual({ runId: "run-open", branch: "kintsugi/legacy-analyst/run-open", url: "https://git.example/pr/1" });
    expect(byId.get("billing/invoice")?.understood).toEqual({ commit: "legacy@" + "b".repeat(40), runId: "run-merged" });
    expect(byId.get("billing/rates")?.lastRun?.id).toBe("run-failed");
    expect(data.counts).toEqual({ understood: 1, failed: 3, "in-pr": 1, "not-analysed": 1, retired: 1 });
  });

  it("serves the AI plan with where its items stand now", async () => {
    const { client } = await memberClient(app, admin, "plan-reader", ["user"]);
    const response = await client.get<{ plan: { strategy: string; batches: Array<{ items: string[] }> } | null; stale: boolean; status: Record<string, string> }>("/projects/shop/applications/web/understand/plan");
    expect(response.status).toBe(200);
    const view = response.body.data!;
    expect(view.plan?.strategy).toBe("Billing first.");
    expect(view.plan?.batches[0]?.items).toEqual(["billing/invoice", "billing/tax", "customers/gone"]);
    // The catalog was not reassessed since: the plan fits; its items carry their status as of now.
    expect(view.stale).toBe(false);
    expect(view.status).toEqual({ "billing/invoice": "understood", "billing/tax": "in-pr", "customers/gone": "retired" });
    expect((await admin.get("/projects/shop/applications/nope/understand/plan")).status).toBe(404);
    expect((await new Client(app).get("/projects/shop/applications/web/understand/plan")).status).toBe(401);
  });

  it("is 404 without a catalog or for an unknown application, 400 for a bad ref", async () => {
    expect((await admin.get("/projects/shop/applications/nope/catalog")).status).toBe(404);
    expect((await admin.get("/projects/shop/applications/web/catalog?ref=refs/heads/kintsugi/legacy-analyst/run-open")).status).toBe(200);
    expect((await admin.get("/projects/shop/applications/web/catalog?ref=main")).status).toBe(400);
    expect((await admin.get(`/projects/shop/applications/web/catalog?ref=${"0".repeat(40)}`)).status).toBe(404);
  });

  type RunView = { id: string; name: string; status: string; scope?: { items: string[] }; resumeOf?: string; abandonedAt?: string };
  type Failure = { message: string; details?: { conflicts?: Array<{ item: string; runId?: string; state: string }>; unknown?: string[] } };

  it("starts understand on a selection, pinned to the catalog's commit, and refuses unknown, retired, blocked and oversized selections", async () => {
    const { client } = await memberClient(app, admin, "viewer", ["user"]);
    expect((await client.request("POST", "/projects/shop/applications/web/understand/runs", { body: { items: ["billing/invoice"] } })).status).toBe(403);
    expect((await admin.request("POST", "/projects/shop/applications/web/stages/understand/run")).status).toBe(400);
    expect((await admin.request("POST", "/projects/shop/applications/web/understand/runs", { body: {} })).status).toBe(400);

    const retired = await admin.request<Failure>("POST", "/projects/shop/applications/web/understand/runs", { body: { items: ["customers/gone", "nope/x"] } });
    expect(retired.status).toBe(400);
    expect((retired.body as unknown as Failure).details?.unknown).toEqual(["customers/gone", "nope/x"]);

    // billing/tax is in an open pull request: the module selection takes it and is refused with the conflict.
    const blocked = await admin.request<Failure>("POST", "/projects/shop/applications/web/understand/runs", { body: { modules: ["billing"] } });
    expect(blocked.status).toBe(409);
    expect((blocked.body as unknown as Failure).details?.conflicts).toEqual([{ item: "billing/tax", runId: "run-open", state: "in-pr" }]);

    process.env["KINTSUGI_STAGE_MAX_AGENTS"] = "1";
    try {
      expect((await admin.request("POST", "/projects/shop/applications/web/understand/runs", { body: { items: ["billing/invoice", "customers/report"] } })).status).toBe(422);
    } finally {
      delete process.env["KINTSUGI_STAGE_MAX_AGENTS"];
    }

    const started = await admin.request<RunView>("POST", "/projects/shop/applications/web/understand/runs", { body: { items: ["customers/report", "billing/invoice"] } });
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    expect(started.body.data).toMatchObject({ name: "understand", status: "queued", scope: { items: ["billing/invoice", "customers/report"] } });
    const inputs = await app.db.query<{ inputs: { scope: { files: string[] }; documentsCommit: string } }>("select inputs from workflow.job_run where id = $1", [started.body.data!.id]);
    expect(inputs.rows[0]?.inputs.scope.files).toEqual(["src/Invoice.java", "src/Report.java"]);
    expect(inputs.rows[0]?.inputs.documentsCommit).toMatch(/^[0-9a-f]{40}$/);

    // Its items are running now: a second run on one of them is refused.
    const again = await admin.request<Failure>("POST", "/projects/shop/applications/web/understand/runs", { body: { items: ["billing/invoice"] } });
    expect(again.status).toBe(409);
    expect((again.body as unknown as Failure).details?.conflicts?.[0]).toMatchObject({ item: "billing/invoice", state: "running" });
    await app.db.query("update workflow.job_run set status = 'cancelled' where id = $1", [started.body.data!.id]);
  });

  it("abandons a closed pull request (its items are released) and retries a failed run on the same commits", async () => {
    expect((await admin.request("POST", "/projects/shop/applications/web/understand/runs", { body: { items: ["billing/tax"] } })).status).toBe(409);
    const abandoned = await admin.request<RunView>("POST", "/projects/shop/job-runs/run-open/abandon");
    expect(abandoned.status).toBe(200);
    expect(abandoned.body.data?.abandonedAt).toBeDefined();
    expect((await admin.request("POST", "/projects/shop/job-runs/run-open/abandon")).status).toBe(409);
    expect((await admin.request("POST", "/projects/shop/job-runs/run-failed/abandon")).status).toBe(409);
    const catalog = await admin.get<{ items: Array<{ id: string; status: string }> }>("/projects/shop/applications/web/catalog");
    expect(catalog.body.data?.items.find((entry) => entry.id === "billing/tax")?.status).toBe("not-analysed");

    expect((await admin.request("POST", "/projects/shop/job-runs/run-open/retry")).status).toBe(409);
    const retried = await admin.request<RunView>("POST", "/projects/shop/job-runs/run-failed/retry");
    expect(retried.status).toBe(202);
    expect(retried.body.data).toMatchObject({ name: "understand", resumeOf: "run-failed", scope: { items: ["customers/update", "billing/rates"] } });
    const inputs = await app.db.query<{ inputs: { documentsCommit: string; resumeOf: string } }>("select inputs from workflow.job_run where id = $1", [retried.body.data!.id]);
    expect(inputs.rows[0]?.inputs).toMatchObject({ documentsCommit: "c".repeat(40), resumeOf: "run-failed" });
    // The same through the selection endpoint.
    await app.db.query("update workflow.job_run set status = 'cancelled' where id = $1", [retried.body.data!.id]);
    const resumed = await admin.request<RunView>("POST", "/projects/shop/applications/web/understand/runs", { body: { resumeOf: "run-failed" } });
    expect(resumed.status).toBe(202);
    expect(resumed.body.data?.resumeOf).toBe("run-failed");
  });

  it("serves the understand results per view for the application (generated) or one item (its own files)", async () => {
    type Results = {
      stage: string;
      empty: boolean;
      scope: { item?: string };
      rules?: Array<{ id: string }>;
      report?: { findings: Array<{ id: string }> } | null;
      units?: Array<{ id: string; spec: string | null; dependsOn: string[]; rules: string[] }>;
      topology?: { nodes: Array<{ id: string }> } | null;
    };
    const base = "/projects/shop/applications/web/understand/results";
    const rules = await admin.get<Results>(`${base}?view=extract-rules&item=billing/invoice`);
    expect(rules.status).toBe(200);
    expect(rules.body.data).toMatchObject({ stage: "extract-rules", empty: false, scope: { item: "billing/invoice" } });
    expect(rules.body.data?.rules?.map((rule) => rule.id)).toEqual(["RULE-billing.invoice-1a2b3c4d"]);
    const findings = await admin.get<Results>(`${base}?view=harden&item=billing/invoice`);
    expect(findings.body.data?.report?.findings.map((finding) => finding.id)).toEqual(["SEC-billing.invoice-01"]);
    const trace = await admin.get<Results>(`${base}?view=understand&item=billing/invoice`);
    expect(trace.body.data?.units?.map((unit) => [unit.id, unit.spec, unit.dependsOn, unit.rules])).toEqual([["web/billing/invoice", "10-applications/web/01-legacy/billing/invoice/spec.md", ["web/billing/rates"], ["RULE-billing.invoice-1a2b3c4d"]]]);
    const map = await admin.get<Results>(`${base}?view=map`);
    expect(map.body.data).toMatchObject({ stage: "map", empty: false, scope: {} });
    expect(map.body.data?.topology?.nodes.map((node) => node.id)).toContain("INV");
    expect((await admin.get<Results>(`${base}?view=extract-rules`)).body.data?.empty).toBe(true);
    expect((await admin.get(`${base}?view=assess`)).status).toBe(400);
    expect((await admin.get(`${base}?view=map&item=..%2Fx`)).status).toBe(400);
  });
});
