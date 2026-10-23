// The document repo is Markdown only (ADR-0042) and numbered in reading order (ADR-0051): the starter template
// teaches formats with Markdown samples and lays out the folders the domain paths name.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { applicationDesignPath, applicationInputPath, applicationRequirementsPath, architectureDir, commonComponentsDir, designSetsDir, generatedDir, glossaryPath, legacyDir, modernDir, transitionDir } from "@kintsugi/domain";
import { describe, expect, it } from "vitest";
import { DESIGN_SETS_PREFIX, designFilesFor, loadDesignSets, type DesignProfileSource, type DesignSetSource } from "../builtin/plugins/reverse_engineering/hooks/reader/design.js";

const TEMPLATE = fileURLToPath(new URL("../../../templates/document-repo", import.meta.url));

describe("the document repo starter template", () => {
  it("lays out the numbered folders the domain paths name, and no gate records", () => {
    const app = "billing-web";
    const expected = [glossaryPath(), designSetsDir(), architectureDir(), commonComponentsDir(), transitionDir(), applicationInputPath(app, "INTENT.md"), legacyDir(app), modernDir(app), applicationRequirementsPath(app), applicationDesignPath(app), generatedDir(app)];
    for (const path of expected) expect(existsSync(join(TEMPLATE, path)), path).toBe(true);
    for (const old of ["program", "portfolio", "standards", "architecture", "gates", "applications"]) expect(existsSync(join(TEMPLATE, old)), old).toBe(false);
  });

  it("holds no JSON outside the project plugins", () => {
    const root = fileURLToPath(new URL("../../../templates/document-repo", import.meta.url));
    const found: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "plugins") walk(path);
        } else if (/\.json(\.example)?$/.test(entry.name)) {
          found.push(relative(root, path));
        }
      }
    };
    walk(root);
    expect(found).toEqual([]);
  });

  it("reads the design sets where the domain layout puts them (the reader imports nothing, so it repeats the prefix)", () => {
    expect(DESIGN_SETS_PREFIX).toBe(designSetsDir());
  });

  it("ships design sets that are valid for the starter's unit kinds", () => {
    const root = join(TEMPLATE, designSetsDir());
    const sources: DesignSetSource[] = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const markdown = (...parts: string[]): string[] => (existsSync(join(root, ...parts)) ? readdirSync(join(root, ...parts)).filter((name) => name.endsWith(".md")) : []);
        const text = (...parts: string[]): string => readFileSync(join(root, ...parts), "utf8");
        const files = markdown(entry.name);
        const profiles: Record<string, DesignProfileSource> = {};
        for (const kind of readdirSync(join(root, entry.name), { withFileTypes: true }).filter((sub) => sub.isDirectory() && !sub.name.startsWith("_"))) {
          const inside = markdown(entry.name, kind.name);
          profiles[kind.name] = {
            profileText: inside.includes("profile.md") ? text(entry.name, kind.name, "profile.md") : undefined,
            templates: Object.fromEntries(inside.filter((name) => name !== "profile.md").map((name) => [name, text(entry.name, kind.name, name)])),
            examples: markdown(entry.name, kind.name, "_examples"),
          };
        }
        return {
          folder: entry.name,
          setText: files.includes("set.md") ? text(entry.name, "set.md") : undefined,
          templates: Object.fromEntries(files.filter((name) => name !== "set.md").map((name) => [name, text(entry.name, name)])),
          examples: markdown(entry.name, "_examples"),
          profiles,
        };
      });
    const manifest = readFileSync(fileURLToPath(new URL("../../../templates/document-repo/kintsugi.yaml", import.meta.url)), "utf8");
    const kinds = /^unitKinds:\s*\[([^\]]*)\]/m.exec(manifest)?.[1]?.split(",").map((kind) => kind.trim()) ?? [];
    const loaded = loadDesignSets(sources, { unitKinds: kinds });
    expect(loaded.problems).toEqual([]);
    expect(loaded.sets.map((entry) => [entry.set.id, entry.set.version, entry.set.needs])).toEqual([["api", 1, ["basic"]], ["basic", 1, []], ["detail", 1, ["basic"]], ["test", 1, ["basic"]]]);
    // The profiles (ADR-0053): the API specification is only for api units; the detail design varies with the kind.
    expect(loaded.sets.map((entry) => [entry.set.id, Object.keys(entry.profiles)])).toEqual([["api", ["api"]], ["basic", []], ["detail", ["batch-job", "db-object", "report", "screen"]], ["test", []]]);
    const detail = loaded.sets.find((entry) => entry.set.id === "detail")!;
    expect(designFilesFor(detail, "db-object").map((file) => file.path)).toEqual(["logic.md", "ddl.md"]);
    expect(designFilesFor(detail, "screen").map((file) => [file.path, file.ref.id, file.example])).toEqual([["logic.md", "detail/screen", "screen/_examples/logic.md"], ["data-access.md", "detail", null]]);
    expect(designFilesFor(detail, "api").map((file) => file.ref.id)).toEqual(["detail", "detail"]);
    expect(designFilesFor(loaded.sets.find((entry) => entry.set.id === "api")!, "screen")).toEqual([]);
  });
});
