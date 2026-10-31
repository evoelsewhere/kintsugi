// Design sets of the application (ADR-0050): a set whose set.md says `scope: application` is one design for the whole
// application, kept under 10-applications/<app>/02-modern/_design/<set>/ and generated for the pseudo-unit `@app`. The sets are the shared
// fixtures of the design-set checkers; the mirror is a real bare clone of a fixture repository served by a local Git server.

import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CheckoutStorage, cloneMirror } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { catalogDocuments } from "../support/documents.js";
import { adminClient, Client, memberClient, startTestApp, type TestApp } from "../support/app.js";

const FIXTURES = fileURLToPath(new URL("../../../../packages/agents/builtin/plugins/modernize/scripts/tests/fixtures/design/", import.meta.url));
const fixture = (...parts: string[]): string => readFileSync(join(FIXTURES, ...parts), "utf8");

const MANIFEST = ["schemaVersion: 1", "project:", "  id: shop", "  name: Shop", "document:", "  server: local", "  path: docs", "unitKinds: [screen, api]", "applications:", "  - id: web", "    repos:", "      - {server: local, path: legacy, role: legacy}", ""].join("\n");
const RULES = ["# Rules", "", "### R-001: Total is computed", "", "### R-002: Rounding", "", "### R-003: Date format", ""].join("\n");
const unitFile = (module: string, unit: string): string => ["---", `id: "web/${module}/${unit}"`, 'application: "web"', `module: "${module}"`, 'kind: "screen"', `title: "${unit}"`, "wave: 2", "---", ""].join("\n");
// A unit's files (ADR-0051): its card and its design sets on the modern side, what is known about it on the legacy side.
const modernPath = (module: string, unit: string, file: string): string => `10-applications/web/02-modern/${module}/${unit}/${file}`;
const legacyPath = (module: string, unit: string, file: string): string => `10-applications/web/01-legacy/${module}/${unit}/${file}`;
const ARCH = "10-applications/web/02-modern/_design/arch/overview.md";
const ARCH_BRANCH = "refs/heads/kintsugi/designer/run-arch";

describe.skipIf(!hasDatabase)("design sets of the application (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let remote: GitHttpServer;
  let dataDir: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-design-app-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    const put = (path: string, text: string, branch?: string): Promise<unknown> => remote.commit("docs", path, text, branch);
    await put("kintsugi.yaml", MANIFEST);
    for (const set of ["basic"]) for (const name of readdirSync(join(FIXTURES, "sets", set))) await put(`01-standards/templates/${set}/${name}`, fixture("sets", set, name));
    for (const set of ["arch", "dbunit"]) for (const name of readdirSync(join(FIXTURES, "app-sets", set))) await put(`01-standards/templates/${set}/${name}`, fixture("app-sets", set, name));
    await put("02-architecture/common/COM-LOG-01.md", "# COM-LOG-01\n");
    await put("02-architecture/common/COM-AUTH-01.md", "# COM-AUTH-01\n");
    await put("10-applications/web/02-modern/requirements.md", "## REQ-01: Pay\n");
    // Design is offered only for units active in the merged catalog.
    const items = [{ id: "billing/invoice", kind: "screen" }, { id: "customers/lookup", kind: "screen" }];
    for (const [path, text] of Object.entries(catalogDocuments("web", [{ id: "billing", name: "Billing" }, { id: "customers", name: "Customers" }], items.map((item) => ({ ...item, files: ["legacy/main.c"] }))))) await put(path, text);
    for (const [module, unit] of [["billing", "invoice"], ["customers", "lookup"]] as const) {
      await put(modernPath(module, unit, "README.md"), unitFile(module, unit));
      await put(legacyPath(module, unit, "rules.md"), RULES);
      await put(legacyPath(module, unit, "understanding.md"), `---\nstatus: understood\ndigest: sha256:${unit}\n---\n`);
      await put(legacyPath(module, unit, "spec.md"), "# Specification\n\n## Gaps and questions\n\nNone.\n");
    }
    // A design run's branch: the architecture of the application is written there (and so is the data of lookup, against it).
    await put(ARCH, fixture("designs", "arch-ok.md"), "kintsugi/designer/run-arch");
    await put(modernPath("customers", "lookup", "dbunit/data.md"), fixture("designs", "dbunit-ok.md"), "kintsugi/designer/run-arch");
    await cloneMirror(`${remote.baseUrl}/docs.git`, new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', $1, 'none')", [remote.baseUrl]);
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', $1, 'main'), ('legacy', 'local', $2, 'main')", [`${remote.baseUrl}/docs.git`, `${remote.baseUrl}/legacy.git`]);
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications", { body: { id: "web", name: "Web" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications/web/repositories", { body: { repositoryId: "legacy", role: "legacy" } })).status).toBe(201);
    await app.db.query("insert into workflow.job_run (id, project_id, application_id, kind, name, status, inputs, created_at) values ('run-assess', 'shop', 'web', 'stage', 'assess', 'succeeded', '{}', now() - interval '6 hours')");
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await remote?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  type SetsView = {
    sets: Array<{ id: string; scope: string; appliesTo: string[]; needs: string[]; reads: string[]; instructions: string; description: string; files: Array<{ path: string }>; usage?: { units: number; onCurrent: number; stale: number } }>;
    problems: Array<{ path: string; message: string }>;
  };
  type Summary = { state: string; ready: boolean; files: { total: number; conformant: number; missing: number } };
  type Overview = {
    sets: Array<{ id: string; scope: string; needs: string[] }>;
    application: { sets: Record<string, Summary> };
    units: Array<{ key: string; sets: Record<string, Summary> }>;
    counts: Record<string, Record<string, number>>;
  };
  type Detail = { unit: { key: string; kind: string; title?: string }; sets: Array<{ set: string; state: string; files: Array<{ path: string; state: string; problems: unknown[] }> }>; coverage: unknown[]; unresolved: unknown[] };
  type Failure = { message: string; details?: { conflicts?: Array<{ unit: string; state: string; needs?: string[] }>; notApplicable?: string[]; unknown?: string[] } };
  const RUNS = "/projects/shop/applications/web/design/runs";

  it("serves a set of the application with its scope, the documents it reads and the instructions for the designer", async () => {
    const view = (await admin.get<SetsView>("/projects/shop/design/sets?app=web")).body.data!;
    expect(view.problems).toEqual([]);
    const arch = view.sets.find((set) => set.id === "arch")!;
    expect(arch).toMatchObject({ scope: "application", appliesTo: [], needs: [], reads: ["10-applications/{app}/01-legacy/", "02-architecture/"] });
    expect(arch.instructions).toContain("Describe the target in terms of the common components.");
    expect(arch.description).toBe("How the application is built as a whole, written once for the application.");
    expect(arch.files.map((file) => file.path)).toEqual(["overview.md"]);
    expect(arch.usage).toEqual({ units: 0, onCurrent: 0, stale: 0 });
    expect(view.sets.find((set) => set.id === "dbunit")).toMatchObject({ scope: "unit", needs: ["arch"] });
    // The same at the branch where the architecture is written.
    const at = (await admin.get<SetsView>(`/projects/shop/design/sets?app=web&ref=${ARCH_BRANCH}`)).body.data!;
    expect(at.sets.find((set) => set.id === "arch")?.usage).toEqual({ units: 1, onCurrent: 1, stale: 0 });
  });

  it("derives the state of the application's own design, and a unit set that needs it waits for it", async () => {
    const view = (await admin.get<Overview>("/projects/shop/applications/web/design")).body.data!;
    expect(view.sets.map((set) => [set.id, set.scope])).toEqual([["arch", "application"], ["basic", "unit"], ["dbunit", "unit"]]);
    expect(view.application.sets["arch"]).toMatchObject({ state: "missing", ready: true });
    expect(Object.keys(view.application.sets)).toEqual(["arch"]);
    // The units are listed with the sets of units only; dbunit needs arch, which is not written.
    expect(view.units.every((unit) => unit.sets["arch"] === undefined)).toBe(true);
    expect(view.units.find((unit) => unit.key === "customers/lookup")?.sets["dbunit"]).toMatchObject({ state: "missing", ready: false });
    expect(view.counts["arch"]).toEqual({ missing: 1 });

    const written = (await admin.get<Overview>(`/projects/shop/applications/web/design?ref=${ARCH_BRANCH}`)).body.data!;
    expect(written.application.sets["arch"]).toMatchObject({ state: "conformant", ready: false });
    // With the architecture written, the data design of a unit that needs it resolves its items (A-002) and is conformant.
    expect(written.units.find((unit) => unit.key === "customers/lookup")?.sets["dbunit"]).toMatchObject({ state: "conformant" });
    expect(written.units.find((unit) => unit.key === "billing/invoice")?.sets["dbunit"]).toMatchObject({ state: "missing", ready: true });
  });

  it("serves the application's design file by file as the pseudo-unit @app", async () => {
    const missing = (await admin.get<Detail>("/projects/shop/applications/web/design/application")).body.data!;
    expect(missing.unit).toMatchObject({ key: "@app", kind: "application", title: "Web" });
    expect(missing.coverage).toEqual([]);
    expect(missing.sets.map((set) => [set.set, set.state, set.files.map((file) => [file.path, file.state])])).toEqual([["arch", "missing", [["overview.md", "missing"]]]]);
    const written = (await admin.get<Detail>(`/projects/shop/applications/web/design/application?ref=${ARCH_BRANCH}`)).body.data!;
    expect(written.sets[0]).toMatchObject({ set: "arch", state: "conformant" });
    expect(written.unresolved).toEqual([]);
    expect((await admin.get("/projects/shop/applications/nope/design/application")).status).toBe(404);
    expect((await new Client(app).get("/projects/shop/applications/web/design/application")).status).toBe(401);
  });

  it("generates the set of the application for @app only, and a set of units never for @app", async () => {
    const { client } = await memberClient(app, admin, "app-design-viewer", ["user"]);
    expect((await client.request("POST", RUNS, { body: { set: "arch", units: ["@app"] } })).status).toBe(403);

    const units = await admin.request<Failure>("POST", RUNS, { body: { set: "arch", units: ["customers/lookup"] } });
    expect(units.status).toBe(400);
    expect((units.body as unknown as Failure).message).toContain("for the application as a whole");
    const both = await admin.request<Failure>("POST", RUNS, { body: { set: "arch", units: ["@app", "customers/lookup"] } });
    expect(both.status).toBe(400);
    const wrong = await admin.request<Failure>("POST", RUNS, { body: { set: "basic", units: ["@app"] } });
    expect(wrong.status).toBe(400);
    expect((wrong.body as unknown as Failure).details?.notApplicable).toEqual(["@app"]);
    // dbunit needs arch, which is not on the default branch yet.
    const needs = await admin.request<Failure>("POST", RUNS, { body: { set: "dbunit", units: ["billing/invoice"] } });
    expect(needs.status).toBe(409);
    expect((needs.body as unknown as Failure).details?.conflicts).toEqual([{ unit: "billing/invoice", state: "not-ready", reasons: ["Needs the merged, conformant arch design first."] }]);

    const started = await admin.request<{ id: string; name: string; scope?: { items: string[]; set?: string } }>("POST", RUNS, { body: { set: "arch", units: ["@app"] } });
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    expect(started.body.data).toMatchObject({ name: "design", scope: { items: ["@app"], set: "arch" } });
    const activity = (await admin.get<{ items: Array<{ unit: string; set: string; state: string }> }>("/projects/shop/applications/web/design/activity")).body.data!;
    expect(activity.items).toEqual([expect.objectContaining({ unit: "@app", set: "arch", state: "running" })]);
    const again = await admin.request<Failure>("POST", RUNS, { body: { set: "arch", units: ["@app"] } });
    expect(again.status).toBe(409);
    expect((again.body as unknown as Failure).details?.conflicts?.[0]).toMatchObject({ unit: "@app", state: "running" });
    await app.db.query("update workflow.job_run set status = 'cancelled' where id = $1", [started.body.data!.id]);
  });
});
