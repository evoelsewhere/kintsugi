// Domain: the hunks of one file's unified diff (what `git diff` prints), with old and new line numbers, for the
// comparison of two versions of a document.

export interface CompareLine {
  type: "context" | "add" | "del";
  /** The line's number in the older version; null for an added line. */
  oldLine: number | null;
  /** The line's number in the newer version; null for a removed line. */
  newLine: number | null;
  text: string;
}

export interface CompareHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: CompareLine[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * The hunks of a unified diff of one file. The header before the first hunk is skipped; a hunk is read by the line
 * counts of its own header, so a changed line that looks like a header line (`--- x`, `@@ y`) is text. A `\ No newline
 * at end of file` marker is not a line.
 */
export function parseUnifiedDiff(patch: string): CompareHunk[] {
  const lines = patch.split("\n");
  const hunks: CompareHunk[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = HUNK_HEADER.exec(lines[index] ?? "");
    if (header === null) continue;
    const hunk: CompareHunk = {
      oldStart: Number(header[1]),
      oldLines: header[2] === undefined ? 1 : Number(header[2]),
      newStart: Number(header[3]),
      newLines: header[4] === undefined ? 1 : Number(header[4]),
      lines: [],
    };
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    let oldLeft = hunk.oldLines;
    let newLeft = hunk.newLines;
    while ((oldLeft > 0 || newLeft > 0) && index + 1 < lines.length) {
      index += 1;
      const line = lines[index] ?? "";
      const mark = line[0];
      if (mark === "\\") continue;
      const text = line.slice(1);
      if (mark === "+") {
        hunk.lines.push({ type: "add", oldLine: null, newLine, text });
        newLine += 1;
        newLeft -= 1;
      } else if (mark === "-") {
        hunk.lines.push({ type: "del", oldLine, newLine: null, text });
        oldLine += 1;
        oldLeft -= 1;
      } else {
        hunk.lines.push({ type: "context", oldLine, newLine, text });
        oldLine += 1;
        newLine += 1;
        oldLeft -= 1;
        newLeft -= 1;
      }
    }
    hunks.push(hunk);
  }
  return hunks;
}
