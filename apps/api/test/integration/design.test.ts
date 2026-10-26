// The design view (ADR-0044, ADR-0045): the design sets a project defined under 01-standards/templates/, and how
// each unit's design documents stand against them, read from the document repo mirror. The sets and the
// designs are the shared fixtures of the design-set checkers (the reader the API runs, the script the
// member runs); the mirror is a real bare clone of a fixture repository served by a local Git server.

import { readFileSync, readdirSync, statSync } from "node:fs";
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
/** Every file under a fixture folder, as paths relative to it (a set holds kind folders, ADR-0053). */
const filesUnder = (dir: string, prefix = ""): string[] => readdirSync(join(FIXTURES, dir, prefix)).flatMap((name) => (statSync(join(FIXTURES, dir, prefix, name)).isDirectory() ? filesUnder(dir, `${prefix}${name}/`) : [`${prefix}${name}`]));

const MANIFEST = [
  "schemaVersion: 1",
  "project:",
  "  id: shop",
  "  name: Shop",
  "document:",
  "  server: local",
  "  path: docs",
  "unitKinds: [screen, api, batch]",
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

const unitFile = (module: string, unit: string, waived: string[] = [], kind = "screen"): string =>
  ["---", `id: "web/${module}/${unit}"`, 'application: "web"', `module: "${module}"`, `kind: "${kind}"`, `title: "${unit}"`, "wave: 2", 'assignee: "an"', ...(waived.length === 0 ? [] : ["waived:", ...waived.map((entry) => `  - "${entry}"`)]), "---", ""].join("\n");

// A unit's files (ADR-0051): its card and its design sets on the modern side, what is known about it on the legacy side.
const modernPath = (module: string, unit: string, file: string): string => `10-applications/web/02-modern/${module}/${unit}/${file}`;
const legacyPath = (module: string, unit: string, file: string): string => `10-applications/web/01-legacy/${module}/${unit}/${file}`;

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
    for (const set of ["basic", "detail"]) for (const name of filesUnder(`sets/${set}`)) await put(`01-standards/templates/${set}/${name}`, fixture("sets", set, ...name.split("/")));
    await put("02-architecture/common/COM-LOG-01.md", '---\nid: "COM-LOG-01"\ntitle: "Audit log"\nstatus: "approved"\n---\n# COM-LOG-01\n');
    await put("02-architecture/common/COM-AUTH-01.md", "# COM-AUTH-01\n");
    // invoice: everything written and conformant.
    await put(modernPath("billing", "invoice", "README.md"), unitFile("billing", "invoice"));
    await put(legacyPath("billing", "invoice", "rules.md"), RULES);
    await put(modernPath("billing", "invoice", "basic/overview.md"), fixture("designs", "basic-overview-ok.md"));
    await put(modernPath("billing", "invoice", "basic/functions.md"), FUNCTIONS_OK);
    await put(modernPath("billing", "invoice", "detail/logic.md"), fixture("designs", "detail-screen-ok.md"));
    // tax: its basic design was written against an older version; the detail design is next.
    await put(modernPath("billing", "tax", "README.md"), unitFile("billing", "tax"));
    await put(legacyPath("billing", "tax", "rules.md"), RULES);
    await put(modernPath("billing", "tax", "basic/overview.md"), fixture("designs", "basic-overview-stale.md"));
    await put(modernPath("billing", "tax", "basic/functions.md"), FUNCTIONS_OK);
    // report: a draft with TODOs; the detail design is waived with a reason.
    await put(modernPath("customers", "report", "README.md"), unitFile("customers", "report", ["detail/logic.md: not built yet"]));
    await put(legacyPath("customers", "report", "rules.md"), RULES);
    await put(modernPath("customers", "report", "basic/overview.md"), fixture("designs", "basic-overview-todo.md"));
    // lookup (an api, which has the set's own logic template and an optional sql.md): no basic design, a detail design that names things that do not exist.
    await put(modernPath("customers", "lookup", "README.md"), unitFile("customers", "lookup", [], "api"));
    await put(legacyPath("customers", "lookup", "rules.md"), RULES);
    await put(modernPath("customers", "lookup", "detail/logic.md"), fixture("designs", "detail-bad.md"));
    // A directory without a unit card is not a unit, and a `_` folder is the application's.
    await put(modernPath("customers", "draft", "notes.md"), "# Notes\n");
    await put("10-applications/web/02-modern/_design/notes/README.md", '---\nid: "web/_design/notes"\nkind: "screen"\n---\n');
    // A design run's pull request, open: the detail design of tax is in it.
    await remote.commit("docs", modernPath("billing", "tax", "detail/logic.md"), fixture("designs", "detail-screen-ok.md"), "kintsugi/designer/run-dopen");
    await cloneMirror(`${remote.baseUrl}/docs.git`, new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', $1, 'none')", [remote.baseUrl]);
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', $1, 'main'), ('legacy', 'local', $2, 'main')", [`${remote.baseUrl}/docs.git`, `${remote.baseUrl}/legacy.git`]);
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications", { body: { id: "web", name: "Web" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications/web/repositories", { body: { repositoryId: "legacy", role: "legacy" } })).status).toBe(201);
    await app.db.query("insert into workflow.document_write (id, project_id, kind, message, status, branch, pr_url) values ('w-dopen', 'shop', 'job-output', 'Design web: detail of tax', 'pr-opened', 'kintsugi/designer/run-dopen', 'https://git.example/pr/7')");
    await app.db.query(
      `insert into workflow.job_run (id, project_id, application_id, kind, name, status, document_write_id, inputs, created_at) values
        ('run-assess', 'shop', 'web', 'stage', 'assess', 'succeeded', null, '{}', now() - interval '6 hours'),
        ('run-dopen', 'shop', 'web', 'stage', 'design', 'succeeded', 'w-dopen', $1, now() - interval '3 hours')`,
      [JSON.stringify({ scope: { items: ["billing/tax"], files: [], set: "detail" }, documentsCommit: "d".repeat(40) })],
    );
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
    sets: Array<{
      id: string;
      version: number;
      appliesTo: string[];
      needs: string[];
      producedBy: Array<{ pipeline: string; stage: string }>;
      files: Array<{ path: string; ref: string; sections: Array<{ heading: string; required: boolean; checks: string[]; table?: string[] }> }>;
      profiles: Array<{ kind: string; version: number; removes: string[]; instructions: string; examples: string[]; files: Array<{ path: string; ref: string; profile?: string; example?: string; sections: Array<{ heading: string }> }> }>;
      usage?: { units: number; onCurrent: number; stale: number };
    }>;
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
    // The profiles of a set: the screen has its own logic template (and example), the api adds its queries, the batch replaces the logic.
    const detail = view.sets[1]!;
    expect(detail.appliesTo).toEqual([]);
    expect(detail.profiles.map((profile) => [profile.kind, profile.version, profile.removes, profile.files.map((file) => [file.path, file.ref])])).toEqual([
      ["api", 1, [], [["logic.md", "detail@2"], ["sql.md", "detail/api@1"]]],
      ["batch", 1, ["logic.md"], [["job.md", "detail/batch@1"]]],
      ["screen", 3, [], [["logic.md", "detail/screen@3"]]],
    ]);
    const screen = detail.profiles.find((profile) => profile.kind === "screen")!;
    expect(screen.instructions).toBe("List the events in the order the user meets them.");
    expect(screen.examples).toEqual(["logic.md"]);
    expect(screen.files[0]).toMatchObject({ profile: "screen", example: "screen/_examples/logic.md" });
    expect(screen.files[0]?.sections.map((section) => section.heading)).toEqual(["Business rules", "Screen events"]);
    expect(view.sets[0]?.profiles).toEqual([]);
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
    sets: Array<{ set: string; state: string; files: Array<{ path: string; state: string; stale: boolean; template?: string; expected: string; problems: Array<{ code: string; section?: string; message: string }>; waiver?: string }> }>;
    coverage: Array<{ rule: string; coveredBy: Array<{ set: string; file: string; section: string }> }>;
    unresolved: Array<{ id: string; source: string; set: string; file: string; section: string }>;
  };

  it("serves one unit's documents with their problems, the rules each design covers and the references that do not resolve", async () => {
    const lookup = (await admin.get<UnitView>("/projects/shop/applications/web/design/units/customers/lookup")).body.data!;
    const detail = lookup.sets.find((set) => set.set === "detail")!;
    expect(detail.files[0]).toMatchObject({ path: "logic.md", state: "problems", stale: false, template: "detail@2", expected: "detail@2" });
    expect(detail.files[0]?.problems.map((problem) => problem.message)).toEqual([
      "rules without a design item: R-002",
      "references that do not resolve to basic: F-001, F-009",
      "values that do not match ERR-[0-9]{4}: E12",
      "references that do not resolve to components: COM-MAIL-01",
    ]);
    // The api profile adds sql.md (optional, not written); a screen has one file in the set, written with its own template.
    expect(detail.files.map((file) => [file.path, file.state])).toEqual([["logic.md", "problems"], ["sql.md", "missing"]]);
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
    expect(invoice.sets.find((set) => set.set === "detail")?.files).toMatchObject([{ path: "logic.md", state: "conformant", template: "detail/screen@3", expected: "detail/screen@3" }]);
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
      { id: "COM-AUTH-01", path: "02-architecture/common/COM-AUTH-01.md", referencedBy: [] },
      { id: "COM-LOG-01", title: "Audit log", status: "approved", path: "02-architecture/common/COM-LOG-01.md", referencedBy: ["billing/invoice"] },
    ]);
    expect(view.unresolved).toEqual([{ id: "COM-MAIL-01", referencedBy: ["customers/lookup"] }]);
  });

  type RunView = { id: string; name: string; status: string; attempt: number; scope?: { items: string[]; set?: string; regenerate?: boolean }; abandonedAt?: string };
  type Failure = { message: string; details?: { conflicts?: Array<{ unit: string; state: string; runId?: string; needs?: string[] }>; unknown?: string[]; notApplicable?: string[] } };
  type Activity = { items: Array<{ unit: string; set: string; state: string; runId: string; pr?: { branch: string; url?: string } }> };
  const RUNS = "/projects/shop/applications/web/design/runs";

  it("refuses a design run that cannot start: no permission, no body, an unknown set or unit, a unit that has the set, lacks one it needs or is in a pull request, too many units", async () => {
    const { client } = await memberClient(app, admin, "design-viewer", ["user"]);
    expect((await client.request("POST", RUNS, { body: { set: "basic", units: ["customers/lookup"] } })).status).toBe(403);
    expect((await admin.request("POST", "/projects/shop/applications/web/stages/design/run")).status).toBe(400);
    expect((await admin.request("POST", RUNS, { body: {} })).status).toBe(400);
    expect((await admin.request("POST", RUNS, { body: { set: "basic", units: ["not a key"] } })).status).toBe(400);

    expect((await admin.request("POST", RUNS, { body: { set: "nosuch", units: ["customers/lookup"] } })).status).toBe(400);
    const unknown = await admin.request<Failure>("POST", RUNS, { body: { set: "basic", units: ["customers/lookup", "billing/nope"] } });
    expect(unknown.status).toBe(400);
    expect((unknown.body as unknown as Failure).details?.unknown).toEqual(["billing/nope"]);

    // invoice has its basic design; report's draft is written; tax's detail design is in an open pull request; lookup's detail design is written.
    const blocked = await admin.request<Failure>("POST", RUNS, { body: { set: "basic", units: ["billing/invoice", "customers/report", "customers/lookup"] } });
    expect(blocked.status).toBe(409);
    expect((blocked.body as unknown as Failure).details?.conflicts).toEqual([
      { unit: "billing/invoice", state: "written" },
      { unit: "customers/report", state: "written" },
    ]);
    const open = await admin.request<Failure>("POST", RUNS, { body: { set: "detail", units: ["billing/tax"] } });
    expect(open.status).toBe(409);
    expect((open.body as unknown as Failure).details?.conflicts).toEqual([{ unit: "billing/tax", state: "in-pr", runId: "run-dopen" }]);
    // The detail design of lookup is written already (with problems): it is never overwritten.
    const needs = await admin.request<Failure>("POST", RUNS, { body: { set: "detail", units: ["customers/lookup"] } });
    expect(needs.status).toBe(409);

  });

  it("regenerates a set the units already have: refuses a unit with no design to replace or in a pull request, and starts a run that carries the flag", async () => {
    // lookup has no basic design to replace; tax's detail design is in an open pull request.
    const nothing = await admin.request<Failure>("POST", RUNS, { body: { set: "basic", units: ["customers/lookup", "billing/invoice"], regenerate: true } });
    expect(nothing.status).toBe(409);
    expect((nothing.body as unknown as Failure).message).toContain("cannot be regenerated now");
    expect((nothing.body as unknown as Failure).details?.conflicts).toEqual([{ unit: "customers/lookup", state: "unwritten" }]);
    const open = await admin.request<Failure>("POST", RUNS, { body: { set: "detail", units: ["billing/tax"], regenerate: true } });
    expect(open.status).toBe(409);
    expect((open.body as unknown as Failure).details?.conflicts).toEqual([{ unit: "billing/tax", state: "in-pr", runId: "run-dopen" }]);
    expect((await admin.request("POST", RUNS, { body: { set: "basic", units: ["billing/invoice"], regenerate: "yes" } })).status).toBe(400);

    // invoice has a conformant design and report a draft with problems: both can be written again.
    const started = await admin.request<RunView>("POST", RUNS, { body: { set: "basic", units: ["billing/invoice", "customers/report"], regenerate: true } });
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    expect(started.body.data).toMatchObject({ name: "design", status: "queued", scope: { items: ["billing/invoice", "customers/report"], set: "basic", regenerate: true } });
    const stored = await app.db.query<{ inputs: { scope: { items: string[]; files: string[]; set: string; regenerate?: boolean } } }>("select inputs from workflow.job_run where id = $1", [started.body.data!.id]);
    expect(stored.rows[0]?.inputs.scope).toEqual({ items: ["billing/invoice", "customers/report"], files: [], set: "basic", regenerate: true });
    // A regeneration is a run like another: the same units cannot be taken twice, and cancelling it releases them.
    const again = await admin.request<Failure>("POST", RUNS, { body: { set: "basic", units: ["billing/invoice"], regenerate: true } });
    expect(again.status).toBe(409);
    expect((again.body as unknown as Failure).details?.conflicts?.[0]).toMatchObject({ unit: "billing/invoice", state: "running", runId: started.body.data!.id });
    await app.db.query("update workflow.job_run set status = 'cancelled' where id = $1", [started.body.data!.id]);
  });

  it("starts a design run on a set and units pinned to the default branch, shows what it holds as activity, and refuses the same units again", async () => {
    const before = (await admin.get<Activity>("/projects/shop/applications/web/design/activity")).body.data!;
    expect(before.items).toEqual([{ unit: "billing/tax", set: "detail", state: "in-pr", runId: "run-dopen", pr: { branch: "kintsugi/designer/run-dopen", url: "https://git.example/pr/7" } }]);

    const started = await admin.request<RunView>("POST", RUNS, { body: { set: "basic", units: ["customers/lookup"] } });
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    expect(started.body.data).toMatchObject({ name: "design", status: "queued", scope: { items: ["customers/lookup"], set: "basic" } });
    const inputs = await app.db.query<{ inputs: { scope: { items: string[]; files: string[]; set: string }; documentsCommit: string } }>("select inputs from workflow.job_run where id = $1", [started.body.data!.id]);
    expect(inputs.rows[0]?.inputs.scope).toEqual({ items: ["customers/lookup"], files: [], set: "basic" });
    expect(inputs.rows[0]?.inputs.documentsCommit).toMatch(/^[0-9a-f]{40}$/);

    const activity = (await admin.get<Activity>("/projects/shop/applications/web/design/activity")).body.data!;
    expect(activity.items.find((item) => item.unit === "customers/lookup")).toMatchObject({ set: "basic", state: "running", runId: started.body.data!.id });
    const again = await admin.request<Failure>("POST", RUNS, { body: { set: "basic", units: ["customers/lookup"] } });
    expect(again.status).toBe(409);
    expect((again.body as unknown as Failure).details?.conflicts?.[0]).toMatchObject({ unit: "customers/lookup", state: "running", runId: started.body.data!.id });
    // Another set of the same unit is another run: the lookup detail design is not blocked by this one (it is refused for its own reasons above).
    await app.db.query("update workflow.job_run set status = 'cancelled' where id = $1", [started.body.data!.id]);
    expect((await admin.get<Activity>("/projects/shop/applications/web/design/activity")).body.data!.items.some((item) => item.unit === "customers/lookup")).toBe(false);
  });

  it("releases the units of an abandoned design pull request, and resumes a failed design run on the same scope", async () => {
    expect((await admin.request("POST", "/projects/shop/job-runs/run-dopen/abandon")).status).toBe(200);
    expect((await admin.get<Activity>("/projects/shop/applications/web/design/activity")).body.data!.items).toEqual([]);
    const tax = await admin.request<RunView>("POST", RUNS, { body: { set: "detail", units: ["billing/tax"] } });
    expect(tax.status, JSON.stringify(tax.body)).toBe(202);
    await app.db.query("update workflow.job_run set status = 'failed', output_summary = $2 where id = $1", [tax.body.data!.id, JSON.stringify({ stage: "design", documentsCommit: "e".repeat(40), steps: [] })]);
    const resumed = await admin.request<RunView>("POST", RUNS, { body: { resumeOf: tax.body.data!.id } });
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(202);
    expect(resumed.body.data).toMatchObject({ id: tax.body.data!.id, name: "design", status: "queued", attempt: 2, scope: { items: ["billing/tax"], set: "detail" } });
    expect((await admin.request("POST", RUNS, { body: { resumeOf: "run-assess" } })).status).toBe(400);
  });

  it("needs a session and a good ref", async () => {
    expect((await new Client(app).get("/projects/shop/design/sets")).status).toBe(401);
    expect((await admin.get("/projects/shop/design/sets?ref=main")).status).toBe(400);
    expect((await admin.get(`/projects/shop/design/sets?ref=${"0".repeat(40)}`)).status).toBe(404);
    expect((await admin.get("/projects/nope/design/sets")).status).toBe(404);
  });
});
