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
    expect(loaded.sets.map((entry) => [entry.set.id, entry.set.needs])).toEqual([["api", []], ["batch-job", []], ["db-object", []], ["report", []], ["screen", []], ["test", []]]);
    // The profiles (ADR-0053): each kind has its own set, which is only for units of that kind; the test set is for every kind.
    expect(loaded.sets.map((entry) => [entry.set.id, Object.keys(entry.profiles)])).toEqual([["api", ["api"]], ["batch-job", ["batch-job"]], ["db-object", ["db-object"]], ["report", ["report"]], ["screen", ["screen"]], ["test", []]]);
    const set = (id: string) => loaded.sets.find((entry) => entry.set.id === id)!;
    expect(designFilesFor(set("screen"), "screen").map((file) => [file.path, file.required])).toEqual([["overview.md", true], ["layout.md", true], ["events.md", true], ["data.md", false]]);
    expect(designFilesFor(set("screen"), "screen").map((file) => [file.path, file.ref.id, file.example])).toContainEqual(["events.md", "screen/screen", "screen/_examples/events.md"]);
    expect(designFilesFor(set("db-object"), "db-object").map((file) => file.path)).toEqual(["overview.md", "definition.md", "migration.md"]);
    expect(designFilesFor(set("api"), "api").map((file) => file.path)).toEqual(["overview.md", "endpoints.md", "security.md"]);
    expect(designFilesFor(set("batch-job"), "batch-job").map((file) => file.path)).toEqual(["overview.md", "schedule.md", "steps.md", "operations.md"]);
    expect(designFilesFor(set("report"), "report").map((file) => file.path)).toEqual(["overview.md", "parameters.md", "layout.md", "data.md"]);
    // A set of a kind is not for the others; the test set is for all of them.
    expect(designFilesFor(set("api"), "screen")).toEqual([]);
    expect(designFilesFor(set("screen"), "batch-job")).toEqual([]);
    for (const kind of kinds) expect(designFilesFor(set("test"), kind).map((file) => file.path), kind).toEqual(["cases.md", "test-data.md"]);
  });
});
