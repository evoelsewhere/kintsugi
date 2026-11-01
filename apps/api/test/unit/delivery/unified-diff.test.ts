// The hunks of a unified diff, with line numbers on both sides.

import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../../../src/modules/delivery/documents/domain/unified-diff.js";

const HEADER = "diff --git a/p.md b/p.md\nindex 1111111..2222222 100644\n--- a/p.md\n+++ b/p.md\n";

describe("parseUnifiedDiff", () => {
  it("reads a hunk with context, a change and numbers on both sides", () => {
    const hunks = parseUnifiedDiff(`${HEADER}@@ -2,4 +2,5 @@ heading\n b\n-c\n+C\n+C2\n d\n e\n`);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toEqual({
      oldStart: 2,
      oldLines: 4,
      newStart: 2,
      newLines: 5,
      lines: [
        { type: "context", oldLine: 2, newLine: 2, text: "b" },
        { type: "del", oldLine: 3, newLine: null, text: "c" },
        { type: "add", oldLine: null, newLine: 3, text: "C" },
        { type: "add", oldLine: null, newLine: 4, text: "C2" },
        { type: "context", oldLine: 4, newLine: 5, text: "d" },
        { type: "context", oldLine: 5, newLine: 6, text: "e" },
      ],
    });
  });

  it("reads several hunks, and a one-line hunk written without counts", () => {
    const hunks = parseUnifiedDiff(`${HEADER}@@ -1 +1 @@\n-a\n+A\n@@ -9,2 +9,1 @@\n-x\n y\n`);
    expect(hunks.map((hunk) => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines, hunk.lines.length])).toEqual([
      [1, 1, 1, 1, 2],
      [9, 2, 9, 1, 2],
    ]);
  });

  it("reads a changed line that looks like a header line as text, by the counts of the hunk", () => {
    const hunks = parseUnifiedDiff(`${HEADER}@@ -1 +1 @@\n--- not a header\n+++ nor this\n@@ -5 +5 @@\n-z\n+Z\n`);
    expect(hunks[0]?.lines.map((line) => [line.type, line.text])).toEqual([
      ["del", "-- not a header"],
      ["add", "++ nor this"],
    ]);
    expect(hunks[1]?.lines).toHaveLength(2);
  });

  it("keeps a line that starts a hunk's text with a space, and drops the no-newline marker", () => {
    const hunks = parseUnifiedDiff(`${HEADER}@@ -1 +1 @@\n- a\n\\ No newline at end of file\n+  a\n\\ No newline at end of file\n`);
    expect(hunks[0]?.lines.map((line) => [line.type, line.text])).toEqual([
      ["del", " a"],
      ["add", "  a"],
    ]);
  });

  it("gives an added file one hunk from line 1, and an empty patch no hunks", () => {
    const hunks = parseUnifiedDiff("diff --git a/p.md b/p.md\nnew file mode 100644\n--- /dev/null\n+++ b/p.md\n@@ -0,0 +1,2 @@\n+one\n+two\n");
    expect(hunks[0]?.lines).toEqual([
      { type: "add", oldLine: null, newLine: 1, text: "one" },
      { type: "add", oldLine: null, newLine: 2, text: "two" },
    ]);
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("keeps a carriage return that ends a line of a CRLF file", () => {
    expect(parseUnifiedDiff(`${HEADER}@@ -1 +1 @@\n-a\r\n+b\r\n`)[0]?.lines.map((line) => line.text)).toEqual(["a\r", "b\r"]);
  });
});
