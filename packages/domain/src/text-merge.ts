/**
 * A three-way text merge by lines (ADR-0098 decision 3): `base` is the text both people started from, `ours` the draft
 * and `theirs` the head that moved meanwhile. Changes in different places combine; the same change on both sides is taken
 * once; a change to the same lines, or to lines next to each other, on both sides is a conflict that someone resolves.
 *
 * Pure: no Git, no database, no framework. A line is kept with its own line ending (LF, CRLF or none at the end of the
 * text), so the merged text keeps the endings as they were written and a missing final newline stays missing. A front
 * matter block is just text.
 */

/** A part of the text that both sides changed differently: the base lines it covers and what each side made of them. */
export interface MergeRegion {
  /** The first base line of the region (0-based) and the line after its last: `baseEnd - baseStart` lines of the base. */
  baseStart: number;
  baseEnd: number;
  /** The lines of each side for these base lines, each with its own line ending. */
  ours: string[];
  theirs: string[];
}

export type MergeResult = { clean: true; merged: string } | { clean: false; regions: MergeRegion[] };

/** The longest edit script Myers' search follows before the changed part is taken as one block. */
const MAX_EDIT_DISTANCE = 1500;

/** A text as lines, each with its line ending; the last has none when the text does not end in a newline. */
export function textLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", start)) {
    lines.push(text.slice(start, at + 1));
    start = at + 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** One side's change: the base lines `[start, end)` become `lines` (an insertion has `start === end`). */
interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

/** The changes that make `side` out of `base`, in base order, never touching each other. */
function hunksOf(base: readonly string[], side: readonly string[]): Hunk[] {
  let head = 0;
  while (head < base.length && head < side.length && base[head] === side[head]) head += 1;
  let tail = 0;
  while (tail < base.length - head && tail < side.length - head && base[base.length - 1 - tail] === side[side.length - 1 - tail]) tail += 1;
  const a = base.slice(head, base.length - tail);
  const b = side.slice(head, side.length - tail);
  if (a.length === 0 && b.length === 0) return [];
  const hunks: Hunk[] = [];
  for (const run of changedRuns(a, b)) hunks.push({ start: head + run.aStart, end: head + run.aEnd, lines: b.slice(run.bStart, run.bEnd) });
  return hunks;
}

interface Run {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/**
 * The runs of `a` and `b` that are not part of a longest common subsequence, found with Myers' O(ND) search. When the
 * texts differ by more than `MAX_EDIT_DISTANCE` lines the whole stretch is one run: a conflict more, never a wrong merge.
 */
function changedRuns(a: readonly string[], b: readonly string[]): Run[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [{ aStart: 0, aEnd: n, bStart: 0, bEnd: m }];
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const trace: Int32Array[] = [];
  const v = new Int32Array(2 * max + 3);
  let found = -1;
  for (let d = 0; d <= max && found < 0; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0)) ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return [{ aStart: 0, aEnd: n, bStart: 0, bEnd: m }];

  // Walk back through the trace to the matched pairs, then read the runs between them.
  const matches: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const previous = trace[d] ?? v;
    const k = x - y;
    const down = k === -d || (k !== d && (previous[offset + k - 1] ?? 0) < (previous[offset + k + 1] ?? 0));
    const previousK = down ? k + 1 : k - 1;
    const previousX = previous[offset + previousK] ?? 0;
    const previousY = previousX - previousK;
    while (x > (down ? previousX : previousX + 1) && y > (down ? previousY + 1 : previousY)) {
      x -= 1;
      y -= 1;
      matches.push([x, y]);
    }
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    matches.push([x, y]);
  }
  matches.reverse();

  const runs: Run[] = [];
  let ai = 0;
  let bi = 0;
  for (const [mx, my] of [...matches, [n, m] as [number, number]]) {
    if (mx > ai || my > bi) runs.push({ aStart: ai, aEnd: mx, bStart: bi, bEnd: my });
    ai = mx + 1;
    bi = my + 1;
  }
  return runs;
}

/** The lines a side makes of the base lines `[start, end)`, given the hunks of that side inside the range. */
function sideLines(base: readonly string[], start: number, end: number, hunks: readonly Hunk[]): string[] {
  const out: string[] = [];
  let at = start;
  for (const hunk of hunks) {
    out.push(...base.slice(at, hunk.start), ...hunk.lines);
    at = hunk.end;
  }
  out.push(...base.slice(at, end));
  return out;
}

const sameLines = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((line, index) => line === right[index]);

/**
 * Merges `ours` and `theirs`, two changes of `base`. Returns the merged text when every change can be combined, else the
 * regions where the two sides changed the same lines (or lines next to each other) in different ways.
 */
export function mergeText(base: string, ours: string, theirs: string): MergeResult {
  if (ours === theirs) return { clean: true, merged: ours };
  if (ours === base) return { clean: true, merged: theirs };
  if (theirs === base) return { clean: true, merged: ours };
  const baseLines = textLines(base);
  const mine = hunksOf(baseLines, textLines(ours));
  const yours = hunksOf(baseLines, textLines(theirs));

  const all = [...mine.map((hunk) => ({ hunk, mine: true })), ...yours.map((hunk) => ({ hunk, mine: false }))].sort((x, y) => x.hunk.start - y.hunk.start || x.hunk.end - y.hunk.end);
  const merged: string[] = [];
  const regions: MergeRegion[] = [];
  let at = 0;
  for (let index = 0; index < all.length; ) {
    // A cluster: the hunks of both sides whose base lines overlap or touch.
    const first = all[index];
    if (first === undefined) break;
    let end = first.hunk.end;
    let last = index + 1;
    while (last < all.length && (all[last]?.hunk.start ?? Number.POSITIVE_INFINITY) <= end) {
      end = Math.max(end, all[last]?.hunk.end ?? end);
      last += 1;
    }
    const cluster = all.slice(index, last);
    const start = first.hunk.start;
    const ourHunks = cluster.filter((entry) => entry.mine).map((entry) => entry.hunk);
    const theirHunks = cluster.filter((entry) => !entry.mine).map((entry) => entry.hunk);
    const ourLines = sideLines(baseLines, start, end, ourHunks);
    const theirLines = sideLines(baseLines, start, end, theirHunks);
    merged.push(...baseLines.slice(at, start));
    if (theirHunks.length === 0) merged.push(...ourLines);
    else if (ourHunks.length === 0) merged.push(...theirLines);
    else if (sameLines(ourLines, theirLines)) merged.push(...ourLines);
    else regions.push({ baseStart: start, baseEnd: end, ours: ourLines, theirs: theirLines });
    at = end;
    index = last;
  }
  if (regions.length > 0) return { clean: false, regions };
  merged.push(...baseLines.slice(at));
  return { clean: true, merged: merged.join("") };
}
