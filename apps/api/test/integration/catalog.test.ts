// The item catalog with derived item status (ADR-0033): the catalog assess merged on the default
// branch, meta.json of understood items, and the understand runs the worker records (running,
// in an open pull request, failed, abandoned). The mirror is a real bare clone of a fixture
// repository served by a local Git server.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { type Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

const item = (id: string, files: string[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  module: id.split("/")[0],
  kind: "program",
  name: id,
  summary: "",
  files,
  leaves: [],
  entryPoints: [],
  loc: 10,
  complexity: "low",
  digest: `sha256:${id.replace(/[^a-z]/g, "")}`,
  status: "active",
  aliases: [],
  parts: [],
  ...extra,
});

export const CATALOG = {
  schemaVersion: 1,
  app: "web",
  source: { repo: "legacy", commit: "a".repeat(40) },
  modules: [
    { id: "billing", name: "Billing", summary: "" },
    { id: "customers", name: "Customers", summary: "" },
  ],
  items: [
    item("billing/invoice", ["src/Invoice.java"]),
    item("billing/rates", ["src/Rates.java"]),
    item("billing/tax", ["src/Tax.java"]),
    item("customers/update", ["src/Update.java"]),
    item("customers/report", ["src/Report.java"]),
    item("customers/lookup", ["src/Lookup.java"]),
    item("customers/gone", ["src/Gone.java"], { status: "retired" }),
  ],
  unassigned: ["README.md"],
  ambiguities: ["src/X.java is claimed by 2 leaves"],
};

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
    await remote.commit("docs", "assessment/web/catalog.json", JSON.stringify(CATALOG));
    // Understood on main: invoice at the catalog's digest, rates at an older one (stale).
    await remote.commit("docs", "knowledge/as-is/web/items/billing/invoice/meta.json", JSON.stringify({ digest: "sha256:billinginvoice", commit: "b".repeat(40), runId: "run-merged" }));
    await remote.commit("docs", "knowledge/as-is/web/items/billing/rates/meta.json", JSON.stringify({ digest: "sha256:old", runId: "run-merged" }));
    await remote.commit("docs", "knowledge/as-is/web/billing/tax.md", "# Tax\n", "kintsugi/legacy-analyst/run-open");
    await remote.commit("docs", "knowledge/as-is/web/customers/report.md", "# Report\n", "kintsugi/legacy-analyst/run-abandoned");
    await cloneMirror(`${remote.baseUrl}/docs.git`, new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', $1, 'none')", [remote.baseUrl]);
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', $1, 'main'), ('legacy', 'local', $2, 'main')", [`${remote.baseUrl}/docs.git`, `${remote.baseUrl}/legacy.git`]);
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications", { body: { id: "web", name: "Web", disposition: "refactor" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications/web/repositories", { body: { repositoryId: "legacy", role: "legacy" } })).status).toBe(201);

    await app.db.query(
      "insert into workflow.document_write (id, project_id, kind, message, status, branch, pr_url) values ('w-open', 'shop', 'job-output', 'Understand web', 'pr-opened', 'kintsugi/legacy-analyst/run-open', 'https://git.example/pr/1'), ('w-abandoned', 'shop', 'job-output', 'Understand web', 'pr-opened', 'kintsugi/legacy-analyst/run-abandoned', null)",
    );
    const scope = (items: string[]): string => JSON.stringify({ scope: { items, files: [] } });
    await app.db.query(
      `insert into workflow.job_run (id, project_id, application_id, kind, name, status, document_write_id, inputs, output_summary, abandoned_at, created_at) values
        ('run-merged', 'shop', 'web', 'stage', 'understand', 'succeeded', null, $1, null, null, now() - interval '5 hours'),
        ('run-open', 'shop', 'web', 'stage', 'understand', 'succeeded', 'w-open', $2, null, null, now() - interval '3 hours'),
        ('run-failed', 'shop', 'web', 'stage', 'understand', 'failed', null, $3, null, null, now() - interval '2 hours'),
        ('run-abandoned', 'shop', 'web', 'stage', 'understand', 'succeeded', 'w-abandoned', $4, $5, now(), now() - interval '90 minutes'),
        ('run-active', 'shop', 'web', 'stage', 'understand', 'running', null, $6, null, null, now() - interval '1 hour')`,
      [
        scope(["billing/invoice", "billing/rates"]),
        scope(["billing/tax"]),
        scope(["customers/update", "billing/rates"]),
        scope(["customers/report", "customers/lookup"]),
        JSON.stringify({ stage: "understand", steps: [{ id: "specify-item", kind: "agent", status: "failed", key: "customers/lookup" }] }),
        scope(["customers/gone"]),
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
    expect(byId.get("billing/tax")?.pr).toEqual({ runId: "run-open", branch: "kintsugi/legacy-analyst/run-open", url: "https://git.example/pr/1" });
    expect(byId.get("billing/invoice")?.understood).toEqual({ commit: "b".repeat(40), runId: "run-merged" });
    expect(byId.get("billing/rates")?.lastRun?.id).toBe("run-failed");
    expect(data.counts).toEqual({ understood: 1, failed: 3, "in-pr": 1, "not-analysed": 1, retired: 1 });
  });

  it("is 404 without a catalog or for an unknown application, 400 for a bad ref", async () => {
    expect((await admin.get("/projects/shop/applications/nope/catalog")).status).toBe(404);
    expect((await admin.get("/projects/shop/applications/web/catalog?ref=refs/heads/kintsugi/legacy-analyst/run-open")).status).toBe(200);
    expect((await admin.get("/projects/shop/applications/web/catalog?ref=main")).status).toBe(400);
    expect((await admin.get(`/projects/shop/applications/web/catalog?ref=${"0".repeat(40)}`)).status).toBe(404);
  });
});
