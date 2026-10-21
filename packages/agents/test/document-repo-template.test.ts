// The document repo is Markdown only (ADR-0042): the starter template teaches formats with Markdown samples.

import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
});
