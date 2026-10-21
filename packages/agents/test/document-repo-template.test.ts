// The document repo is Markdown only (ADR-0042): the starter template teaches formats with Markdown samples.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDesignSets, type DesignSetSource } from "../builtin/plugins/reverse_engineering/hooks/reader/design.js";

describe("the document repo starter template", () => {
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

  it("ships design sets that are valid for the starter's unit kinds", () => {
    const root = fileURLToPath(new URL("../../../templates/document-repo/standards/design", import.meta.url));
    const sources: DesignSetSource[] = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const files = readdirSync(join(root, entry.name)).filter((name) => name.endsWith(".md"));
        const text = (name: string): string => readFileSync(join(root, entry.name, name), "utf8");
        return { folder: entry.name, setText: files.includes("set.md") ? text("set.md") : undefined, templates: Object.fromEntries(files.filter((name) => name !== "set.md").map((name) => [name, text(name)])) };
      });
    const manifest = readFileSync(fileURLToPath(new URL("../../../templates/document-repo/kintsugi.yaml", import.meta.url)), "utf8");
    const kinds = /^unitKinds:\s*\[([^\]]*)\]/m.exec(manifest)?.[1]?.split(",").map((kind) => kind.trim()) ?? [];
    const loaded = loadDesignSets(sources, { unitKinds: kinds });
    expect(loaded.problems).toEqual([]);
    expect(loaded.sets.map((entry) => [entry.set.id, entry.set.version, entry.set.needs])).toEqual([["basic", 1, []], ["detail", 1, ["basic"]]]);
  });
});
