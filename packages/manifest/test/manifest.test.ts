import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_AUTO_COMMIT_PATHS, DEFAULT_UNIT_KINDS, manifestFromProject } from "@kintsugi/domain";
import { describe, expect, it } from "vitest";
import { parseKintsugiYaml, renderKintsugiYaml } from "../src/index.js";

const root = resolve(import.meta.dirname, "../../..");

describe("kintsugi.yaml", () => {
  it("parses the starter template and retains every default auto-commit path", () => {
    const result = parseKintsugiYaml(readFileSync(resolve(root, "templates/document-repo/kintsugi.yaml"), "utf8"));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.manifest.applications[0]!.repos.map((repo) => repo.role)).toEqual(["legacy", "legacy-data", "target", "target"]);
    expect(result.manifest.autoCommitPaths).toEqual(DEFAULT_AUTO_COMMIT_PATHS);
    // One source of unit kinds: the starter declares the kinds the portal renders by default.
    expect(result.manifest.unitKinds).toEqual([...DEFAULT_UNIT_KINDS]);
  });

  it("parses the example in the document repo reference", () => {
    const reference = readFileSync(resolve(root, "docs/reference/document-repo-manifest.md"), "utf8");
    const example = /```yaml\n([\s\S]*?)```/.exec(reference)?.[1];
    expect(example).toBeDefined();
    const result = parseKintsugiYaml(example!);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.manifest.pipelines.map((pipeline) => pipeline.id)).toEqual(["payroll-rebuild"]);
  });

  it("reports YAML syntax errors", () => {
    const result = parseKintsugiYaml("project: [unclosed\n");
    expect(result.ok).toBe(false);
  });

  it("reports every schema problem of an invalid file", () => {
    const result = parseKintsugiYaml(
      [
        "schemaVersion: 1",
        "project: {id: billing, name: Billing}",
        "document: {server: github, path: org/docs}",
        "unitKinds: [screen]",
        "applications:",
        "  - id: web",
        "    repos:",
        "      - {server: github, path: org/web, role: target}",
        "      - {server: github, path: org/docs, role: legacy}",
        "policy: {requireCommitTrailer: maybe}",
      ].join("\n"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.path)).toEqual(["applications[0].repos[0].component", "applications[0].repos[1]", "policy.requireCommitTrailer"]);
  });

  it("renders a manifest that parses back to itself", () => {
    const manifest = manifestFromProject({
      project: { id: "billing", name: "Billing" },
      document: { server: "github", path: "org/billing-docs" },
      applications: [
        {
          id: "web",
          name: "Billing web",
          pipeline: "custom",
          repos: [
            { server: "github", path: "org/web-legacy", role: "legacy" },
            { server: "azdo", path: "Billing/_git/web-api", role: "target", component: "api" },
          ],
        },
      ],
    });
    const text = renderKintsugiYaml(manifest, { header: "Rendered by Kintsugi." });
    expect(text.startsWith("# Rendered by Kintsugi.\n")).toBe(true);
    expect(text).toContain("- {server: github, path: org/web-legacy, role: legacy}");
    expect(parseKintsugiYaml(text)).toEqual({ ok: true, manifest });
    // The default (nothing is published directly) is not written out.
    expect(text).not.toContain("directPublishPaths");
  });

  it("reads and renders directPublishPaths, and rejects a value that is not a list of relative globs", () => {
    const base = ["schemaVersion: 1", "project: {id: billing, name: Billing}", "document: {server: github, path: org/docs}", "unitKinds: [screen]", "applications: []"];
    const result = parseKintsugiYaml([...base, "directPublishPaths:", "  - 20-spaces/eng/**", "  - 20-spaces/ops/*.md"].join("\n"));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.manifest.directPublishPaths).toEqual(["20-spaces/eng/**", "20-spaces/ops/*.md"]);
    expect(renderKintsugiYaml(result.manifest)).toContain("directPublishPaths:\n  - 20-spaces/eng/**");
    expect(parseKintsugiYaml(renderKintsugiYaml(result.manifest))).toEqual(result);
    const bad = parseKintsugiYaml([...base, "directPublishPaths: 20-spaces/**"].join("\n"));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.map((problem) => problem.path)).toContain("directPublishPaths");
    expect(parseKintsugiYaml([...base, "directPublishPaths: [\"/etc/**\"]"].join("\n")).ok).toBe(false);
  });
});
