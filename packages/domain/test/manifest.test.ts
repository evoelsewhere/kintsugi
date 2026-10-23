import { describe, expect, it } from "vitest";
import { CORE_ITEM_KINDS, DEFAULT_AUTO_COMMIT_PATHS, isAutoCommitPath, manifestFromProject, matchesPathGlob, repositoryPath, validateManifest } from "../src/index.js";

const minimal = {
  schemaVersion: 1,
  project: { id: "billing", name: "Billing" },
  document: { server: "github", path: "org/billing-docs" },
  unitKinds: ["screen"],
  applications: [
    {
      id: "web",
      pipeline: "rebuild",
      repos: [
        { server: "github", path: "org/web-legacy", role: "legacy" },
        { server: "github", path: "org/web-api", role: "target", component: "api" },
      ],
    },
  ],
};

describe("kintsugi.yaml validation", () => {
  it("accepts a minimal manifest and fills the defaults", () => {
    const result = validateManifest(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.pipelines).toEqual([]);
    expect(result.manifest.autoCommitPaths).toEqual(DEFAULT_AUTO_COMMIT_PATHS);
    expect(result.manifest.policy.requireCommitTrailer).toBe(true);
  });

  it("keeps the design set a pipeline stage produces", () => {
    const stage = { id: "detail-design", performer: { member: ["dev"] }, produces: "detail" };
    const result = validateManifest({ ...minimal, pipelines: [{ id: "payroll-rebuild", phases: [{ id: "migrate", perUnit: true, stages: [stage, { id: "review", performer: { agent: "gate-reviewer" } }] }] }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stages = result.manifest.pipelines[0]!.phases[0]!.stages;
    expect(stages[0]).toEqual(stage);
    expect(stages[1]).not.toHaveProperty("produces");
    const bad = validateManifest({ ...minimal, pipelines: [{ id: "p", phases: [{ id: "migrate", stages: [{ ...stage, produces: "Detail Design" }] }] }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.map((problem) => problem.path)).toEqual(["pipelines[0].phases[0].stages[0].produces"]);
  });

  it("reports every problem with its path", () => {
    const result = validateManifest({
      schemaVersion: 2,
      project: { id: "Billing" },
      document: { server: "github", path: "org/billing-docs" },
      unitKinds: [],
      applications: [
        {
          id: "web",
          repos: [
            { server: "github", path: "org/billing-docs", role: "legacy" },
            { server: "github", path: "org/web-api", role: "target" },
            { server: "github", path: "org/web-db", role: "legacy-data", component: "db" },
            { server: "github", path: "org/x", role: "document" },
          ],
        },
        { id: "web" },
      ],
      pipelines: [{ id: "custom", phases: [{ id: "harden", stages: [{ id: "do", performer: { agent: "a", member: ["dev"] } }] }] }],
      extra: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.path)).toEqual([
      "extra",
      "schemaVersion",
      "project.id",
      "project.name",
      "unitKinds",
      "applications[0].repos[0]",
      "applications[0].repos[1].component",
      "applications[0].repos[2].component",
      "applications[0].repos[3].role",
      "applications[1].id",
      "pipelines[0].phases[0].category",
      "pipelines[0].phases[0].stages[0].performer",
    ]);
  });

  it("round-trips a manifest built from project state", () => {
    const manifest = manifestFromProject({
      project: { id: "billing", name: "Billing" },
      document: { server: "github", path: "org/billing-docs" },
      applications: [
        {
          id: "web",
          name: "Web",
          repos: [
            { server: "github", path: "org/web-api", role: "target", component: "api" },
            { server: "github", path: "org/web-legacy", role: "legacy" },
          ],
        },
      ],
    });
    expect(manifest.applications[0]!.repos.map((repo) => repo.role)).toEqual(["legacy", "target"]);
    // A project that declares no unit kinds gets the core item kinds (ADR-0060).
    expect(manifest.unitKinds).toEqual([...CORE_ITEM_KINDS]);
    expect(validateManifest(JSON.parse(JSON.stringify(manifest)))).toEqual({ ok: true, manifest });
  });
});

describe("repository path", () => {
  it("is the clone URL's path relative to the server, without .git", () => {
    expect(repositoryPath("https://github.com/org/app.git", "https://github.com")).toBe("org/app");
    expect(repositoryPath("https://dev.azure.com/org/Billing/_git/web", "https://dev.azure.com/org")).toBe("Billing/_git/web");
    expect(repositoryPath("git@github.com:org/app.git", "https://github.com")).toBe("org/app");
    expect(repositoryPath("ssh://git@gitlab.example.com:2222/team/app.git", "https://gitlab.example.com")).toBe("team/app");
  });
});

describe("autoCommitPaths globs", () => {
  it("spans folders with ** and stays within a segment with * and ?", () => {
    expect(matchesPathGlob("10-applications/web/02-modern/payroll/run-period/README.md", "10-applications/*/02-modern/**/README.md")).toBe(true);
    expect(matchesPathGlob("10-applications/web/02-modern/README.md", "10-applications/*/02-modern/**/README.md")).toBe(true);
    expect(matchesPathGlob("10-applications/web/01-legacy/payroll/README.md", "10-applications/*/02-modern/**/README.md")).toBe(false);
    expect(matchesPathGlob("10-applications/team/web/02-modern/payroll/README.md", "10-applications/*/02-modern/*/*/README.md")).toBe(false);
    expect(matchesPathGlob("tasks/t-1.md", "tasks/*.md")).toBe(true);
    expect(matchesPathGlob("tasks/a/t-1.md", "tasks/*.md")).toBe(false);
    expect(matchesPathGlob("runs/a/b.json", "**/b.json")).toBe(true);
    expect(matchesPathGlob("a+b.md", "a+b.md")).toBe(true);
  });

  it("splits writes by the application and unit defaults", () => {
    expect(isAutoCommitPath("10-applications/web/02-modern/payroll/run-period/README.md", DEFAULT_AUTO_COMMIT_PATHS)).toBe(true);
    expect(isAutoCommitPath("10-applications/web/02-modern/payroll/run-period/task.md", DEFAULT_AUTO_COMMIT_PATHS)).toBe(true);
    expect(isAutoCommitPath("10-applications/web/_generated/traceability.md", DEFAULT_AUTO_COMMIT_PATHS)).toBe(true);
    expect(isAutoCommitPath("10-applications/web/01-legacy/plan.md", DEFAULT_AUTO_COMMIT_PATHS)).toBe(true);
    expect(isAutoCommitPath("10-applications/web/01-legacy/payroll/run-period/rules.md", DEFAULT_AUTO_COMMIT_PATHS)).toBe(false);
    expect(isAutoCommitPath("10-applications/web/02-modern/payroll/run-period/basic/README.md", DEFAULT_AUTO_COMMIT_PATHS)).toBe(false);
    expect(isAutoCommitPath("10-applications/web/02-modern/_design/arch/README.md", DEFAULT_AUTO_COMMIT_PATHS)).toBe(true);
    expect(isAutoCommitPath("10-applications/web/02-modern/README.md", DEFAULT_AUTO_COMMIT_PATHS)).toBe(false);
    expect(isAutoCommitPath("10-applications/team/web/_generated/a.json", DEFAULT_AUTO_COMMIT_PATHS)).toBe(false);
    expect(isAutoCommitPath("kintsugi.yaml", DEFAULT_AUTO_COMMIT_PATHS)).toBe(false);
    expect(isAutoCommitPath("01-standards/review-rules.md", DEFAULT_AUTO_COMMIT_PATHS)).toBe(false);
  });
});
