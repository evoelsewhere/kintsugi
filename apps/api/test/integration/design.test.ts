// The design view (ADR-0044, ADR-0045): the design sets a project defined under standards/design/, and how
// each unit's design documents stand against them, read from the document repo mirror. The sets and the
// designs are the shared fixtures of the design-set checkers (the reader the API runs, the script the
// member runs); the mirror is a real bare clone of a fixture repository served by a local Git server.

import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CheckoutStorage, cloneMirror } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

const FIXTURES = fileURLToPath(new URL("../../../../packages/agents/builtin/plugins/modernize/scripts/tests/fixtures/design/", import.meta.url));
const fixture = (...parts: string[]): string => readFileSync(join(FIXTURES, ...parts), "utf8");

const MANIFEST = [
  "schemaVersion: 1",
  "project:",
  "  id: shop",
  "  name: Shop",
  "document:",
  "  server: local",
  "  path: docs",
  "unitKinds: [screen, api]",
  "applications:",
  "  - id: web",
  "    repos:",
  "      - {server: local, path: legacy, role: legacy}",
  "      - {server: local, path: web-ui, role: target, component: web}",
  "pipelines:",
  "  - id: custom",
  "    phases:",
  "      - id: migrate",
  "        perUnit: true",
  "        stages:",
  "          - {id: detail-design, performer: {member: [dev]}, produces: detail}",
  "          - {id: ghost-design, performer: {member: [dev]}, produces: ghost}",
  "",
].join("\n");

const RULES = ["# Rules", "", "### R-001: Total is computed", "", "### R-002: Rounding", "", "### R-003: Date format", ""].join("\n");

const FUNCTIONS_OK = ["---", 'template: "basic@3"', "---", "# Functions", "", "## Functions", "", "| ID | Function | Priority |", "| --- | --- | --- |", "| F-001 | Compute | high |", "| F-002 | Print | low |", ""].join("\n");

const unitFile = (module: string, unit: string, waived: string[] = []): string =>
  ["---", `id: "web/${module}/${unit}"`, 'application: "web"', `module: "${module}"`, 'kind: "screen"', `title: "${unit}"`, "wave: 2", 'assignee: "an"', ...(waived.length === 0 ? [] : ["waived:", ...waived.map((entry) => `  - "${entry}"`)]), "---", ""].join("\n");

const unitPath = (module: string, unit: string, file: string): string => `applications/web/units/${module}/${unit}/${file}`;

describe.skipIf(!hasDatabase)("design sets and unit designs (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let remote: GitHttpServer;
  let dataDir: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-design-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    const put = (path: string, text: string): Promise<unknown> => remote.commit("docs", path, text);
    await put("kintsugi.yaml", MANIFEST);
    for (const set of ["basic", "detail"]) for (const name of readdirSync(join(FIXTURES, "sets", set))) await put(`standards/design/${set}/${name}`, fixture("sets", set, name));
    await put("architecture/common/COM-LOG-01.md", '---\nid: "COM-LOG-01"\ntitle: "Audit log"\nstatus: "approved"\n---\n# COM-LOG-01\n');
    await put("architecture/common/COM-AUTH-01.md", "# COM-AUTH-01\n");
    // invoice: everything written and conformant.
    await put(unitPath("billing", "invoice", "unit.md"), unitFile("billing", "invoice"));
    await put(unitPath("billing", "invoice", "understanding/rules.md"), RULES);
    await put(unitPath("billing", "invoice", "design/basic/overview.md"), fixture("designs", "basic-overview-ok.md"));
    await put(unitPath("billing", "invoice", "design/basic/functions.md"), FUNCTIONS_OK);
    await put(unitPath("billing", "invoice", "design/detail/logic.md"), fixture("designs", "detail-ok.md"));
    // tax: its basic design was written against an older version; the detail design is next.
    await put(unitPath("billing", "tax", "unit.md"), unitFile("billing", "tax"));
    await put(unitPath("billing", "tax", "understanding/rules.md"), RULES);
    await put(unitPath("billing", "tax", "design/basic/overview.md"), fixture("designs", "basic-overview-stale.md"));
    await put(unitPath("billing", "tax", "design/basic/functions.md"), FUNCTIONS_OK);
    // report: a draft with TODOs; the detail design is waived with a reason.
    await put(unitPath("customers", "report", "unit.md"), unitFile("customers", "report", ["detail/logic.md: not built yet"]));
    await put(unitPath("customers", "report", "understanding/rules.md"), RULES);
    await put(unitPath("customers", "report", "design/basic/overview.md"), fixture("designs", "basic-overview-todo.md"));
    // lookup: no basic design, a detail design that names things that do not exist.
    await put(unitPath("customers", "lookup", "unit.md"), unitFile("customers", "lookup"));
    await put(unitPath("customers", "lookup", "understanding/rules.md"), RULES);
    await put(unitPath("customers", "lookup", "design/detail/logic.md"), fixture("designs", "detail-bad.md"));
    // A directory without a unit file is not a unit.
    await put(unitPath("customers", "draft", "notes.md"), "# Notes\n");
    await cloneMirror(`${remote.baseUrl}/docs.git`, new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', $1, 'none')", [remote.baseUrl]);
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', $1, 'main'), ('legacy', 'local', $2, 'main')", [`${remote.baseUrl}/docs.git`, `${remote.baseUrl}/legacy.git`]);
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications", { body: { id: "web", name: "Web" } })).status).toBe(201);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await remote?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  type SetsView = {
    ref: { ref: string };
    sets: Array<{ id: string; version: number; needs: string[]; producedBy: Array<{ pipeline: string; stage: string }>; files: Array<{ path: string; sections: Array<{ heading: string; required: boolean; checks: string[]; table?: string[] }> }>; usage?: { units: number; onCurrent: number; stale: number } }>;
    problems: Array<{ path: string; message: string }>;
  };

  it("serves the sets in the order they are written, with the contract of every section and the stage that produces each", async () => {
    const { client } = await memberClient(app, admin, "design-reader", ["user"]);
    const response = await client.get<SetsView>("/projects/shop/design/sets");
    expect(response.status).toBe(200);
    const view = response.body.data!;
    expect(view.ref.ref).toBe("refs/heads/main");
    expect(view.sets.map((set) => [set.id, set.version, set.needs])).toEqual([["basic", 3, []], ["detail", 2, ["basic"]]]);
    expect(view.sets[1]?.producedBy).toEqual([{ pipeline: "custom", stage: "detail-design" }]);
    expect(view.sets[0]?.producedBy).toEqual([]);
    const logic = view.sets[1]?.files.find((file) => file.path === "logic.md");
    expect(logic?.sections.map((section) => [section.heading, section.required])).toEqual([["Business rules", true], ["Error handling", true], ["Dependencies", false]]);
    expect(logic?.sections[0]?.checks).toEqual(["covers-rules(Rule)", "refs-resolve(Function -> basic)", "no-placeholder"]);
    expect(logic?.sections[0]?.table).toEqual(["Rule", "Logic", "Function"]);
    // The manifest names a stage that produces a set that does not exist.
    expect(view.problems).toEqual([{ path: "kintsugi.yaml", message: 'pipeline "custom", stage "ghost-design" produces "ghost", which is not a design set' }]);
  });

  it("reports how an application's units stand with each set", async () => {
    const response = await admin.get<SetsView>("/projects/shop/design/sets?app=web");
    expect(response.status).toBe(200);
    // basic: invoice (current), tax (stale), report (a draft); lookup has none. detail: invoice, lookup.
    expect(Object.fromEntries(response.body.data!.sets.map((set) => [set.id, set.usage]))).toEqual({
      basic: { units: 3, onCurrent: 2, stale: 1 },
      detail: { units: 2, onCurrent: 2, stale: 0 },
    });
    expect((await admin.get("/projects/shop/design/sets?app=nope")).status).toBe(404);
    expect((await admin.get("/projects/shop/design/sets?app=Not%20An%20Id")).status).toBe(400);
  });

  type Overview = {
    sets: Array<{ id: string }>;
    units: Array<{ key: string; kind: string; wave?: string; owner?: string; sets: Record<string, { state: string; ready: boolean; files: { total: number; stale: number; waived: number } }>; rules: { total: number; uncovered: number | null } }>;
    counts: Record<string, Record<string, number>>;
    rules: { units: number; total: number; uncovered: number };
    attention: Array<{ kind: string; count: number }>;
    templateProblems: number;
  };

  it("derives the state of every unit's design per set, and what to design next", async () => {
    const response = await admin.get<Overview>("/projects/shop/applications/web/design");
    expect(response.status).toBe(200);
    const view = response.body.data!;
    expect(view.sets.map((set) => set.id)).toEqual(["basic", "detail"]);
    expect(view.units.map((unit) => unit.key)).toEqual(["billing/invoice", "billing/tax", "customers/lookup", "customers/report"]);
    const states = Object.fromEntries(view.units.map((unit) => [unit.key, Object.fromEntries(Object.entries(unit.sets).map(([set, summary]) => [set, summary.state]))]));
    expect(states).toEqual({
      "billing/invoice": { basic: "conformant", detail: "conformant" },
      // A stale design with no fault is stale; the detail design is not written.
      "billing/tax": { basic: "stale", detail: "missing" },
      "customers/lookup": { basic: "missing", detail: "problems" },
      // The draft has faults; the detail design is waived.
      "customers/report": { basic: "problems", detail: "waived" },
    });
    const byKey = new Map(view.units.map((unit) => [unit.key, unit]));
    expect(byKey.get("billing/invoice")).toMatchObject({ kind: "screen", wave: "2", owner: "an", rules: { total: 3, uncovered: 0 } });
    // The next design: the sets it needs are written (a stale one counts) and nothing of it is.
    expect(byKey.get("billing/tax")?.sets["detail"]?.ready).toBe(true);
    expect(byKey.get("customers/lookup")?.sets["basic"]?.ready).toBe(true);
    expect(byKey.get("customers/lookup")?.sets["detail"]?.ready).toBe(false);
    expect(byKey.get("billing/invoice")?.sets["detail"]?.ready).toBe(false);
    expect(byKey.get("customers/report")?.sets["detail"]?.files.waived).toBe(1);
    expect(byKey.get("billing/tax")?.sets["basic"]?.files.stale).toBe(1);
    expect(view.counts).toEqual({ basic: { conformant: 1, stale: 1, problems: 1, missing: 1 }, detail: { conformant: 1, missing: 1, problems: 1, waived: 1 } });
    // Rules a written design leaves out: the draft names one of three; the detail design of lookup names two.
    expect(byKey.get("customers/report")?.rules).toEqual({ total: 3, uncovered: 2 });
    expect(byKey.get("customers/lookup")?.rules).toEqual({ total: 3, uncovered: 1 });
    expect(view.rules).toEqual({ units: 4, total: 12, uncovered: 3 });
    expect(Object.fromEntries(view.attention.map((entry) => [entry.kind, entry.count]))).toEqual({ "template-error": 1, "unresolved-component": 1, "uncovered-rules": 2, stale: 1 });
    expect(view.templateProblems).toBe(1);
  });

  type UnitView = {
    unit: { key: string; kind: string };
    sets: Array<{ set: string; state: string; files: Array<{ path: string; state: string; stale: boolean; template?: string; problems: Array<{ code: string; section?: string; message: string }>; waiver?: string }> }>;
    coverage: Array<{ rule: string; coveredBy: Array<{ set: string; file: string; section: string }> }>;
    unresolved: Array<{ id: string; source: string; set: string; file: string; section: string }>;
  };

  it("serves one unit's documents with their problems, the rules each design covers and the references that do not resolve", async () => {
    const lookup = (await admin.get<UnitView>("/projects/shop/applications/web/design/units/customers/lookup")).body.data!;
    const detail = lookup.sets.find((set) => set.set === "detail")!;
    expect(detail.files[0]).toMatchObject({ path: "logic.md", state: "problems", stale: false, template: "detail@2" });
    expect(detail.files[0]?.problems.map((problem) => problem.message)).toEqual([
      "rules without a design item: R-002",
      "references that do not resolve to basic: F-001, F-009",
      "values that do not match ERR-[0-9]{4}: E12",
      "references that do not resolve to components: COM-MAIL-01",
    ]);
    // sql.md is for the unit kind api: a screen has one file in the set.
    expect(detail.files.map((file) => file.path)).toEqual(["logic.md"]);
    // Nothing of the basic design is written, so every function the detail design names is unresolved.
    expect(lookup.unresolved).toEqual([
      { id: "F-001", source: "basic", set: "detail", file: "logic.md", section: "Business rules" },
      { id: "F-009", source: "basic", set: "detail", file: "logic.md", section: "Business rules" },
      { id: "COM-MAIL-01", source: "components", set: "detail", file: "logic.md", section: "Dependencies" },
    ]);
    // Uncovered rules come first.
    expect(lookup.coverage.map((row) => [row.rule, row.coveredBy.length])).toEqual([["R-002", 0], ["R-001", 1], ["R-003", 1]]);

    const report = (await admin.get<UnitView>("/projects/shop/applications/web/design/units/customers/report")).body.data!;
    expect(report.sets.find((set) => set.set === "detail")?.files[0]).toMatchObject({ path: "logic.md", state: "waived", waiver: "not built yet" });
    expect(report.sets.find((set) => set.set === "basic")?.files.map((file) => [file.path, file.state])).toEqual([["overview.md", "problems"], ["functions.md", "missing"]]);

    const invoice = (await admin.get<UnitView>("/projects/shop/applications/web/design/units/billing/invoice")).body.data!;
    expect(invoice.unresolved).toEqual([]);
    expect(invoice.coverage.every((row) => row.coveredBy.length === 2)).toBe(true);

    expect((await admin.get("/projects/shop/applications/web/design/units/customers/draft")).status).toBe(404);
    expect((await admin.get("/projects/shop/applications/web/design/units/billing/nope")).status).toBe(404);
    expect((await admin.get("/projects/shop/applications/nope/design/units/billing/invoice")).status).toBe(404);
  });

  it("lists the common components with the units that name them, and the ones no document defines", async () => {
    const view = (
      await admin.get<{ components: Array<{ id: string; title?: string; status?: string; path: string; referencedBy: string[] }>; unresolved: Array<{ id: string; referencedBy: string[] }> }>("/projects/shop/applications/web/design/common")
    ).body.data!;
    expect(view.components).toEqual([
      { id: "COM-AUTH-01", path: "architecture/common/COM-AUTH-01.md", referencedBy: [] },
      { id: "COM-LOG-01", title: "Audit log", status: "approved", path: "architecture/common/COM-LOG-01.md", referencedBy: ["billing/invoice"] },
    ]);
    expect(view.unresolved).toEqual([{ id: "COM-MAIL-01", referencedBy: ["customers/lookup"] }]);
  });

  it("needs a session and a good ref", async () => {
    expect((await new Client(app).get("/projects/shop/design/sets")).status).toBe(401);
    expect((await admin.get("/projects/shop/design/sets?ref=main")).status).toBe(400);
    expect((await admin.get(`/projects/shop/design/sets?ref=${"0".repeat(40)}`)).status).toBe(404);
    expect((await admin.get("/projects/nope/design/sets")).status).toBe(404);
  });
});
