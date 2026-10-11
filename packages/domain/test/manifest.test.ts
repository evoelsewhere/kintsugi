import { describe, expect, it } from "vitest";
import { DEFAULT_AUTO_COMMIT_PATHS, manifestFromProject, repositoryPath, validateManifest } from "../src/index.js";

const minimal = {
  schemaVersion: 1,
  project: { id: "billing", name: "Billing" },
  document: { server: "github", path: "org/billing-docs" },
  unitKinds: ["screen"],
  applications: [
    {
      id: "web",
      disposition: "refactor",
      pipeline: "refactor",
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

  it("reports every problem with its path", () => {
    const result = validateManifest({
      schemaVersion: 2,
      project: { id: "Billing" },
      document: { server: "github", path: "org/billing-docs" },
      unitKinds: [],
      applications: [
        {
          id: "web",
          disposition: "lift-and-shift",
          repos: [
            { server: "github", path: "org/billing-docs", role: "legacy" },
            { server: "github", path: "org/web-api", role: "target" },
            { server: "github", path: "org/web-db", role: "legacy-data", component: "db" },
            { server: "github", path: "org/x", role: "document" },
          ],
        },
        { id: "web", disposition: "retain" },
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
      "applications[0].disposition",
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
          disposition: "refactor",
          repos: [
            { server: "github", path: "org/web-api", role: "target", component: "api" },
            { server: "github", path: "org/web-legacy", role: "legacy" },
          ],
        },
      ],
    });
    expect(manifest.applications[0]!.repos.map((repo) => repo.role)).toEqual(["legacy", "target"]);
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
