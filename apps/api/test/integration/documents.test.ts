// Document repo reads (ADR-0025, ADR-0028): refs, tree and file from the mirror under the data
// directory, and stage results built from the outputs a run wrote. The mirror is a real bare
// clone of a fixture repository served by a local Git server; runs and writes are the rows the
// worker records.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror, fetchMirror } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { type Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

const INVENTORY = JSON.stringify({
  app: "web",
  fileCount: 2,
  sourceFileCount: 2,
  sloc: 40,
  ksloc: 0.04,
  complexityIndex: 0.08,
  languages: { Java: 2 },
  languageMetrics: { Java: { files: 2, lines: 50, sloc: 40, complexity: 4 } },
  files: [
    { path: "src/A.java", language: "Java", lines: 30, sloc: 25, cyclomaticComplexity: 3, bytes: 900 },
    { path: "src/B.java", language: "Java", lines: 20, sloc: 15, cyclomaticComplexity: 1, bytes: 500 },
  ],
});

const ASSESSMENT = `# Application Assessment — web

## Executive Summary

A small Java service.

## Technical Debt

| # | Finding | Location | Why it matters |
|---|---|---|---|
| 1 | Hardcoded fee | \`src/A.java:8\` | Policy in code |

## Security Findings

| ID | CWE | Severity | Location | Finding |
|---|---|---|---|---|
| SEC-001 | CWE-862 | Medium | \`src/A.java:16-22\` | No authorization check |

## Recommended Modernization Pattern

Rebuild on the target architecture.
`

const TOPOLOGY = JSON.stringify({
  system: "Web",
  root: {
    id: "sys",
    kind: "system",
    children: [
      { id: "dom:core", name: "Core", kind: "domain", children: [{ id: "a", name: "A.java", kind: "module", loc: 25, file: "src/A.java" }, { id: "b", name: "B.java", kind: "module", loc: 15, file: "src/B.java" }] },
      { id: "dom:data", name: "Data stores", kind: "domain", children: [{ id: "ds:ACCOUNT", name: "ACCOUNT", kind: "datastore" }] },
    ],
  },
  edges: [
    { source: "a", target: "b", kind: "call" },
    { source: "b", target: "ds:ACCOUNT", kind: "read" },
  ],
  entryPoints: ["a"],
  deadEnds: [],
  observations: ["One store."],
});

// What merge_traceability.py writes for two units of web (ADR-0031).
const TRACEABILITY = JSON.stringify({
  app: "web",
  generatedBy: "merge_traceability.py",
  inputs: { businessRules: true, securityFindings: false },
  units: [
    {
      id: "web/core/a",
      module: "core",
      unit: "a",
      title: "A",
      kind: "module",
      loc: 25,
      entryPoint: true,
      spec: "knowledge/as-is/web/core/a.md",
      files: ["src/A.java"],
      dependsOn: ["web/core/b"],
      usedBy: [],
      dataStores: [],
      externalSystems: [],
      rules: ["RULE-001"],
      findings: [],
      dataObjects: [],
      entryPoints: ["src/A.java:3"],
      openQuestions: 1,
    },
    { id: "web/core/b", module: "core", unit: "b", title: "B", kind: "module", loc: 15, entryPoint: false, spec: null, files: ["src/B.java"], dependsOn: [], usedBy: ["web/core/a"], dataStores: [{ id: "ds:ACCOUNT", access: ["read"] }], externalSystems: [], rules: [], findings: [], dataObjects: [], entryPoints: [], openQuestions: 0 },
  ],
  rules: { "RULE-001": ["web/core/a"] },
  findings: {},
  files: { "src/A.java": ["web/core/a"], "src/B.java": ["web/core/b"] },
  dataStores: { "ds:ACCOUNT": ["web/core/b"] },
  unmappedRules: ["RULE-002"],
  unmappedFindings: [],
  cycles: [],
  notes: { "unknown rule ids": 1 },
});

describe.skipIf(!hasDatabase)("document repo reads (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let remote: GitHttpServer;
  let dataDir: string;
  let mapBranchTip: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-documents-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    // assess merged on main; map proposed on a kintsugi/* branch.
    await remote.commit("docs", "assessment/web/inventory.json", INVENTORY);
    await remote.commit("docs", "assessment/web/ASSESSMENT.md", ASSESSMENT);
    await remote.commit("docs", "assessment/web/ARCHITECTURE.mmd", "graph TD\n  A --> B\n");
    await remote.commit("docs", "standards/README.md", "# Standards\n");
    await remote.commit("docs", "assessment/web/topology.json", TOPOLOGY, "kintsugi/legacy-analyst/run-map");
    await remote.commit("docs", "assessment/web/call-graph.mmd", "graph TD\n  a --> b\n", "kintsugi/legacy-analyst/run-map");
    mapBranchTip = remote.git("docs", "rev-parse", "kintsugi/legacy-analyst/run-map").trim();
    // understand proposed on its own branch: specifications, synthesis and work items in one pull request.
    const understand = "kintsugi/legacy-analyst/run-understand";
    await remote.commit("docs", "knowledge/as-is/web/traceability.json", TRACEABILITY, understand);
    await remote.commit("docs", "knowledge/as-is/web/README.md", "# Web AS-IS\n", understand);
    await remote.commit("docs", "knowledge/as-is/web/architecture.md", "# Architecture\n\n```mermaid\nflowchart LR\n  core --> data\n```\n", understand);
    await remote.commit("docs", "knowledge/as-is/web/core/a.md", "# A\n", understand);
    await remote.commit("docs", "units/web/core/a.md", '---\nid: "web/core/a"\nstatus: pending\ncomplexity: low\n---\n\nA.\n', understand);
    await cloneMirror(`${remote.baseUrl}/docs.git`, new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', $1, 'none')", [remote.baseUrl]);
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', $1, 'main'), ('legacy', 'local', $2, 'main')", [`${remote.baseUrl}/docs.git`, `${remote.baseUrl}/legacy.git`]);
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications", { body: { id: "web", name: "Web", disposition: "refactor" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications/web/repositories", { body: { repositoryId: "legacy", role: "legacy" } })).status).toBe(201);

    // What the worker records for a merged assess run and an open map run.
    await app.db.query(
      "insert into workflow.document_write (id, project_id, kind, message, status, branch) values ('w-assess', 'shop', 'job-output', 'Assess web', 'committed', null), ('w-map', 'shop', 'job-output', 'Map web', 'pr-opened', 'kintsugi/legacy-analyst/run-map'), ('w-gone', 'shop', 'job-output', 'Old map', 'pr-opened', 'kintsugi/legacy-analyst/gone'), ('w-understand', 'shop', 'job-output', 'Understand web', 'pr-opened', 'kintsugi/legacy-analyst/run-understand')",
    );
    await app.db.query(
      `insert into workflow.job_run (id, project_id, application_id, kind, name, status, document_write_id, finished_at, created_at) values
        ('run-assess', 'shop', 'web', 'stage', 'assess', 'succeeded', 'w-assess', now() - interval '2 hours', now() - interval '3 hours'),
        ('run-map-old', 'shop', 'web', 'stage', 'map', 'succeeded', 'w-gone', now() - interval '90 minutes', now() - interval '100 minutes'),
        ('run-map', 'shop', 'web', 'stage', 'map', 'succeeded', 'w-map', now() - interval '1 hour', now() - interval '70 minutes'),
        ('run-harden', 'shop', 'web', 'stage', 'harden', 'failed', null, null, now())`,
    );
    await app.db.query(
      `insert into workflow.job_run (id, project_id, application_id, kind, name, status, document_write_id, output_summary, finished_at, created_at) values
        ('run-understand', 'shop', 'web', 'stage', 'understand', 'succeeded', 'w-understand', $1, now() - interval '10 minutes', now() - interval '20 minutes')`,
      [JSON.stringify({ stage: "understand", missingInputs: [{ path: "assessment/web/SECURITY_FINDINGS.md", stage: "harden" }] })],
    );
  });
  afterAll(async () => {
    await app?.close();
    await remote?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("needs a session, not a permission", async () => {
    const anonymous = await fetch(`${app.baseUrl}/projects/shop/documents/refs`);
    expect(anonymous.status).toBe(401);
    const { client } = await memberClient(app, admin, "reader", ["user"]);
    expect((await client.get("/projects/shop/documents/refs")).status).toBe(200);
  });

  it("lists the default branch and the outputs of successful runs that are still in the mirror", async () => {
    const refs = await admin.get<{ defaultBranch: string; refs: Array<Record<string, unknown>> }>("/projects/shop/documents/refs");
    expect(refs.status).toBe(200);
    expect(refs.body.data?.defaultBranch).toBe("main");
    expect(refs.body.data?.refs.map((ref) => [ref["kind"], ref["ref"], ref["status"], ref["stage"] ?? null, ref["runId"] ?? null])).toEqual([
      ["default", "refs/heads/main", "default", null, null],
      ["run", "refs/heads/kintsugi/legacy-analyst/run-understand", "open", "understand", "run-understand"],
      ["run", "refs/heads/kintsugi/legacy-analyst/run-map", "open", "map", "run-map"],
    ]);
    expect(refs.body.data?.refs[2]?.["commit"]).toBe(mapBranchTip);
  });

  it("lists a directory and reads a file at a ref, parsing JSON", async () => {
    const root = await admin.get<{ commit: string; entries: Array<{ path: string; kind: string }> }>("/projects/shop/documents/tree");
    expect(root.body.data?.entries.map((entry) => [entry.path, entry.kind])).toEqual([
      ["assessment", "dir"],
      ["standards", "dir"],
      ["README.md", "file"],
    ]);
    const onBranch = await admin.get<{ entries: Array<{ name: string; size?: number }> }>(`/projects/shop/documents/tree?path=assessment/web&ref=refs/heads/kintsugi/legacy-analyst/run-map`);
    expect(onBranch.body.data?.entries.map((entry) => entry.name)).toEqual(["ARCHITECTURE.mmd", "ASSESSMENT.md", "call-graph.mmd", "inventory.json", "topology.json"]);

    const file = await admin.get<{ format: string; json: { sloc: number }; size: number; commit: string }>("/projects/shop/documents/file?path=assessment/web/inventory.json");
    expect(file.status).toBe(200);
    expect(file.body.data).toMatchObject({ format: "json", json: { sloc: 40 }, size: INVENTORY.length });
    const byCommit = await admin.get<{ content: string }>(`/projects/shop/documents/file?path=assessment/web/topology.json&ref=${mapBranchTip}`);
    expect(byCommit.body.data?.content).toBe(TOPOLOGY);
  });

  it("refuses unsafe paths, restricted/, unknown refs and directories", async () => {
    for (const path of ["../etc/passwd", "/etc/passwd", ".git/config", "a//b", "assessment\\web"]) {
      expect((await admin.get(`/projects/shop/documents/file?path=${encodeURIComponent(path)}`)).status, path).toBe(400);
    }
    expect((await admin.get("/projects/shop/documents/file?path=restricted/SECRETS.local.md")).status).toBe(403);
    expect((await admin.get("/projects/shop/documents/tree?path=assessment/web/restricted")).status).toBe(403);
    expect((await admin.get("/projects/shop/documents/file?path=assessment/web/missing.md")).status).toBe(404);
    expect((await admin.get("/projects/shop/documents/file?path=assessment")).status).toBe(400);
    expect((await admin.get("/projects/shop/documents/tree?path=README.md")).status).toBe(404);
    expect((await admin.get("/projects/shop/documents/file?path=README.md&ref=main")).status).toBe(400);
    expect((await admin.get("/projects/shop/documents/file?path=README.md&ref=refs/heads/../x")).status).toBe(400);
    expect((await admin.get("/projects/shop/documents/file?path=README.md&ref=refs/heads/nope")).status).toBe(404);
    expect((await admin.get(`/projects/shop/documents/file?path=README.md&ref=${"0".repeat(40)}`)).status).toBe(404);
    expect((await admin.get("/projects/missing/documents/refs")).status).toBe(404);
  });

  it("builds the assess results from the default branch when the run committed there", async () => {
    const results = await admin.get<Record<string, unknown> & { ref: Record<string, unknown>; inventory: { sloc: number; files: unknown[] }; highlights: Record<string, unknown>; counts: Record<string, number>; headline: string[]; document: { path: string } }>(
      "/projects/shop/applications/web/stages/assess/results",
    );
    expect(results.status).toBe(200);
    const data = results.body.data!;
    expect(data.ref).toMatchObject({ ref: "refs/heads/main", status: "default", runId: "run-assess" });
    expect(data.empty).toBe(false);
    expect(data.inventory.sloc).toBe(40);
    expect(data.inventory.files).toHaveLength(2);
    expect(data["architecture"]).toBe("graph TD\n  A --> B\n");
    expect(data.highlights).toMatchObject({ summary: "A small Java service.", recommendation: "Rebuild on the target architecture.", security: [{ id: "SEC-001", severity: "Medium", cwe: "CWE-862" }] });
    expect(data.counts).toMatchObject({ files: 2, sloc: 40, debtItems: 1, securityFindings: 1 });
    expect(data.headline).toEqual(["40 SLOC", "2 files"]);
    expect(data.document.path).toBe("assessment/web/ASSESSMENT.md");
  });

  it("builds the map results from the latest successful run's open branch", async () => {
    const results = await admin.get<{ ref: Record<string, unknown>; topology: { nodes: Array<Record<string, unknown>>; edges: unknown[]; observations: string[]; domains: string[] }; diagrams: Array<{ id: string }>; counts: Record<string, number> }>(
      "/projects/shop/applications/web/stages/map/results?compare=true",
    );
    expect(results.status).toBe(200);
    const data = results.body.data!;
    expect(data.ref).toMatchObject({ kind: "run", status: "open", runId: "run-map", branch: "kintsugi/legacy-analyst/run-map", commit: mapBranchTip });
    expect(data.topology.nodes.map((node) => [node["id"], node["kind"], node["inDegree"], node["outDegree"], node["entryPoint"]])).toEqual([
      ["a", "module", 0, 1, true],
      ["b", "module", 1, 1, false],
      ["ds:ACCOUNT", "datastore", 1, 0, false],
    ]);
    expect(data.topology.domains).toEqual(["Core", "Data stores"]);
    expect(data.topology.observations).toEqual(["One store."]);
    expect(data.diagrams.map((diagram) => diagram.id)).toEqual(["call-graph"]);
    expect(data.counts).toMatchObject({ modules: 2, edges: 2, dataStores: 1, entryPoints: 1 });
    // The older run's branch is gone: nothing to compare with.
    expect(data).not.toHaveProperty("previous");

    // The default branch has no map output yet.
    const onMain = await admin.get<{ empty: boolean; topology: null; ref: { kind: string } }>("/projects/shop/applications/web/stages/map/results?ref=refs/heads/main");
    expect(onMain.body.data).toMatchObject({ empty: true, topology: null, ref: { kind: "default" } });
  });

  it("shows empty results for a stage that never succeeded, and headlines per stage", async () => {
    const harden = await admin.get<{ empty: boolean; report: null; restrictedRecords: number; headline: string[] }>("/projects/shop/applications/web/stages/harden/results");
    expect(harden.body.data).toMatchObject({ empty: true, report: null, restrictedRecords: 0, headline: [] });
    expect((await admin.get("/projects/shop/applications/web/stages/transform/results")).status).toBe(400);
    expect((await admin.get("/projects/shop/applications/missing/stages/assess/results")).status).toBe(404);

    const headlines = await admin.get<Array<{ stage: string; headline: string[] }>>("/projects/shop/applications/web/results/headlines");
    expect(headlines.body.data?.map((entry) => [entry.stage, entry.headline])).toEqual([
      ["assess", ["40 SLOC", "2 files"]],
      ["map", ["2 modules", "2 edges"]],
      ["extract-rules", []],
      ["harden", []],
      ["understand", ["2 units", "1 module"]],
    ]);
  });

  it("builds the understand results: units with their work items, the matrix, the synthesis documents and the missing inputs", async () => {
    const results = await admin.get<{
      ref: Record<string, unknown>;
      empty: boolean;
      units: Array<Record<string, unknown>>;
      matrix: Record<string, unknown>;
      documents: Array<{ id: string; path: string; markdown: string }>;
      missingInputs: unknown[];
      counts: Record<string, number>;
      headline: string[];
      document: { path: string };
      files: Array<{ path: string }>;
    }>("/projects/shop/applications/web/stages/understand/results");
    expect(results.status).toBe(200);
    const data = results.body.data!;
    expect(data.ref).toMatchObject({ kind: "run", status: "open", runId: "run-understand", branch: "kintsugi/legacy-analyst/run-understand" });
    expect(data.empty).toBe(false);
    expect(data.units.map((unit) => [unit["id"], unit["key"], unit["spec"], unit["workItem"] ?? null])).toEqual([
      ["web/core/a", "core/a", "knowledge/as-is/web/core/a.md", { path: "units/web/core/a.md", status: "pending", complexity: "low" }],
      ["web/core/b", "core/b", null, null],
    ]);
    expect(data.matrix).toMatchObject({ path: "knowledge/as-is/web/traceability.json", rulesCovered: ["RULE-001"], unmappedRules: ["RULE-002"], dataStores: ["ds:ACCOUNT"], notes: { "unknown rule ids": 1 } });
    expect(data.documents.map((document) => [document.id, document.path])).toEqual([
      ["readme", "knowledge/as-is/web/README.md"],
      ["architecture", "knowledge/as-is/web/architecture.md"],
    ]);
    expect(data.documents[1]?.markdown).toContain("```mermaid");
    expect(data.document.path).toBe("knowledge/as-is/web/README.md");
    expect(data.missingInputs).toEqual([{ path: "assessment/web/SECURITY_FINDINGS.md", stage: "harden" }]);
    expect(data.counts).toMatchObject({ units: 2, modules: 1, specified: 1, notWritten: 1, rulesCovered: 1, rulesUncovered: 1, files: 2, workItems: 1, leftOut: 1, openQuestions: 1 });
    expect(data.headline).toEqual(["2 units", "1 module"]);
    expect(data.files.map((file) => file.path)).toEqual(["knowledge/as-is/web/traceability.json", "knowledge/as-is/web/README.md", "knowledge/as-is/web/architecture.md"]);

    // Not merged yet: the default branch has no understand output.
    const onMain = await admin.get<{ empty: boolean; units: unknown[]; matrix: null; documents: unknown[] }>("/projects/shop/applications/web/stages/understand/results?ref=refs/heads/main");
    expect(onMain.body.data).toMatchObject({ empty: true, units: [], matrix: null, documents: [] });
  });

  it("follows the mirror: a newer commit on the run's branch shows after a fetch", async () => {
    await remote.commit("docs", "assessment/web/critical-path.mmd", "flowchart TD\n  x --> y\n", "kintsugi/legacy-analyst/run-map");
    await fetchMirror(new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });
    const results = await admin.get<{ diagrams: Array<{ id: string }> }>("/projects/shop/applications/web/stages/map/results");
    expect(results.body.data?.diagrams.map((diagram) => diagram.id)).toEqual(["call-graph", "critical-path"]);
  });
});
