// node --test scripts/doc-links.test.mjs — the rules of the docs link check (doc-links.mjs).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { anchorsOf, checkRepository, linksOf, slugOf } from "./doc-links.mjs";

test("anchors follow GitHub's slug rule, repeats numbered, code spans kept", () => {
  assert.equal(slugOf("Upgrade and backup"), "upgrade-and-backup");
  assert.equal(slugOf("5.2 Level 2 — containers and code"), "52-level-2--containers-and-code");
  const anchors = anchorsOf("# Title\n## `rules.md`, `rules/<rule id>.md` and `rules-review.md`\n## Steps\n## Steps\n<a id=\"custom\"></a>\n```\n# not a heading\n```\n");
  assert.deepEqual([...anchors].sort(), ["custom", "rulesmd-rulesrule-idmd-and-rules-reviewmd", "steps", "steps-1", "title"]);
});

test("only relative links outside code count", () => {
  const links = linksOf("[a](b.md) [web](https://example.com) [mail](mailto:x@y) `[c](d.md)`\n```\n[e](f.md)\n```\n![img](pic.png \"t\")");
  assert.deepEqual(links, [{ line: 1, target: "b.md" }, { line: 5, target: "pic.png" }]);
});

test("reports a missing file and a missing anchor with file and line, and passes what resolves", () => {
  const root = mkdtempSync(join(tmpdir(), "doc-links-"));
  mkdirSync(join(root, "docs", "guides"), { recursive: true });
  writeFileSync(join(root, "docs", "guides", "a.md"), "# A\n\n## Two words\n\n[ok](b.md#b) [self](#two-words) [gone](missing.md)\n[bad anchor](b.md#nope)\n");
  writeFileSync(join(root, "docs", "guides", "b.md"), "# B\n");
  writeFileSync(join(root, "README.md"), "[guide](docs/guides/a.md#a)\n");
  mkdirSync(join(root, "node_modules", "x"), { recursive: true });
  writeFileSync(join(root, "node_modules", "x", "README.md"), "[broken](nowhere.md)\n");
  assert.deepEqual(checkRepository(root), ["docs/guides/a.md:5: missing.md -> no such file", "docs/guides/a.md:6: b.md#nope -> no heading or anchor #nope"]);
});
