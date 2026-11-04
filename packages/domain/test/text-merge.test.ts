// The three-way text merge (P2-030, ADR-0098 decision 3): the cases that decide what a second editor gets, and a seeded
// property test over random texts. The merge is pure, so nothing here needs Git or a database.

import { describe, expect, it } from "vitest";
import { type MergeResult, mergeText, textLines } from "../src/text-merge.js";

const lines = (...values: string[]): string => values.map((value) => `${value}\n`).join("");
const merged = (result: MergeResult): string => {
  if (!result.clean) throw new Error(`conflict: ${JSON.stringify(result.regions)}`);
  return result.merged;
};

describe("textLines", () => {
  it("keeps each line's own ending and a last line without one", () => {
    expect(textLines("a\nb\r\nc")).toEqual(["a\n", "b\r\n", "c"]);
    expect(textLines("a\n")).toEqual(["a\n"]);
    expect(textLines("")).toEqual([]);
    expect(textLines("\n\n")).toEqual(["\n", "\n"]);
  });
});

describe("mergeText", () => {
  const base = lines("# Title", "", "First paragraph.", "", "Second paragraph.", "", "Third paragraph.");

  it("combines changes in different places", () => {
    const ours = base.replace("First paragraph.", "First paragraph, edited by us.");
    const theirs = base.replace("Third paragraph.", "Third paragraph, edited by them.");
    expect(merged(mergeText(base, ours, theirs))).toBe(base.replace("First paragraph.", "First paragraph, edited by us.").replace("Third paragraph.", "Third paragraph, edited by them."));
  });

  it("takes a change that one side made alone, and the same change on both sides once", () => {
    const edited = base.replace("Second paragraph.", "Second paragraph, edited.");
    expect(merged(mergeText(base, edited, base))).toBe(edited);
    expect(merged(mergeText(base, base, edited))).toBe(edited);
    expect(merged(mergeText(base, edited, edited))).toBe(edited);
    expect(merged(mergeText(base, base, base))).toBe(base);
    // The same change in two places of a larger one: still once.
    expect(merged(mergeText(base, edited.replace("Third paragraph.", "Third."), edited.replace("Third paragraph.", "Third.")))).toBe(edited.replace("Third paragraph.", "Third."));
  });

  it("makes a conflict of a change to the same lines on both sides", () => {
    const result = mergeText(base, base.replace("Second paragraph.", "Ours."), base.replace("Second paragraph.", "Theirs."));
    expect(result).toEqual({ clean: false, regions: [{ baseStart: 4, baseEnd: 5, ours: ["Ours.\n"], theirs: ["Theirs.\n"] }] });
  });

  it("makes a conflict of a deletion against an edit of the same line", () => {
    const result = mergeText(base, base.replace("Second paragraph.\n", ""), base.replace("Second paragraph.", "Second, edited."));
    expect(result).toEqual({ clean: false, regions: [{ baseStart: 4, baseEnd: 5, ours: [], theirs: ["Second, edited.\n"] }] });
  });

  it("makes a conflict of edits to lines next to each other, but not of edits with one unchanged line between", () => {
    const text = lines("a", "b", "c", "d", "e");
    expect(mergeText(text, lines("A", "b", "c", "d", "e"), lines("a", "B", "c", "d", "e")).clean).toBe(false);
    expect(merged(mergeText(text, lines("A", "b", "c", "d", "e"), lines("a", "b", "C", "d", "e")))).toBe(lines("A", "b", "C", "d", "e"));
  });

  it("treats an insertion at the point of another side's change as a conflict, and two equal insertions as one", () => {
    const text = lines("a", "b");
    expect(mergeText(text, lines("a", "x", "b"), lines("a", "y", "b")).clean).toBe(false);
    expect(merged(mergeText(text, lines("a", "x", "b"), lines("a", "x", "b")))).toBe(lines("a", "x", "b"));
    expect(merged(mergeText(text, lines("a", "x", "b"), lines("a", "b", "z")))).toBe(lines("a", "x", "b", "z"));
  });

  it("starts from an empty base: both sides added a page is a conflict unless it is the same page", () => {
    expect(mergeText("", lines("ours"), lines("theirs")).clean).toBe(false);
    expect(merged(mergeText("", lines("same"), lines("same")))).toBe(lines("same"));
    expect(merged(mergeText("", lines("only ours"), ""))).toBe(lines("only ours"));
    expect(merged(mergeText("", "", lines("only theirs")))).toBe(lines("only theirs"));
  });

  it("keeps line endings as written, mixed ones included, and a missing final newline", () => {
    const crlf = "one\r\ntwo\r\nthree\r\nfour";
    const ours = "ONE\r\ntwo\r\nthree\r\nfour";
    const theirs = "one\r\ntwo\r\nthree\r\nFOUR";
    expect(merged(mergeText(crlf, ours, theirs))).toBe("ONE\r\ntwo\r\nthree\r\nFOUR");
    const mixed = "a\nb\r\nc\n";
    expect(merged(mergeText(mixed, "A\nb\r\nc\n", "a\nb\r\nC\n"))).toBe("A\nb\r\nC\n");
    // Ending in a newline against not ending in one is a change of that line.
    expect(merged(mergeText("a\nb", "a\nb\n", "a\nb"))).toBe("a\nb\n");
    expect(mergeText("a\nb", "a\nb\n", "a\nB").clean).toBe(false);
  });

  it("reads a front matter block as text like any other", () => {
    const page = "---\ntitle: One\nlabels: [a]\n---\n\nBody.\n";
    const ours = page.replace("title: One", "title: Ours");
    const theirs = page.replace("Body.", "Body, changed.");
    expect(merged(mergeText(page, ours, theirs))).toBe("---\ntitle: Ours\nlabels: [a]\n---\n\nBody, changed.\n");
    expect(mergeText(page, ours, page.replace("title: One", "title: Theirs")).clean).toBe(false);
  });

  it("reports every region of a text with several conflicts, in order", () => {
    const text = lines("a", "x1", "b", "c", "x2", "d");
    const result = mergeText(text, lines("a", "o1", "b", "c", "o2", "d"), lines("a", "t1", "b", "c", "t2", "d"));
    expect(result.clean).toBe(false);
    if (!result.clean) expect(result.regions.map((region) => [region.baseStart, region.baseEnd])).toEqual([[1, 2], [4, 5]]);
  });

  it("merges a text of 1 MiB with edits far apart in under a second", () => {
    const row = (n: number): string => `Row ${String(n).padStart(6, "0")}: the batch computes the tax of an invoice line number ${n}.\n`;
    const big = Array.from({ length: 15_000 }, (_, n) => row(n)).join("");
    expect(big.length).toBeGreaterThan(1024 * 1024);
    const ours = big.replace(row(100), "Edited near the top.\n").replace(row(6000), "");
    const theirs = big.replace(row(14_900), "Edited near the end.\n").replace(row(3000), `${row(3000)}An added row.\n`);
    const started = performance.now();
    const result = mergeText(big, ours, theirs);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(merged(result)).toBe(big.replace(row(100), "Edited near the top.\n").replace(row(6000), "").replace(row(14_900), "Edited near the end.\n").replace(row(3000), `${row(3000)}An added row.\n`));
  });
});

// ---- Property test --------------------------------------------------------------------------------------------------

/** A small deterministic generator (mulberry32), so a failing round can be replayed from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Edit {
  /** The base lines [from, to) become `lines` (fresh, unique lines); an insertion has from === to. */
  from: number;
  to: number;
  lines: string[];
}

/** The base with the edits applied; edits must not overlap and are given in base order. */
function apply(base: readonly string[], edits: readonly Edit[]): string {
  const out: string[] = [];
  let at = 0;
  for (const edit of edits) {
    out.push(...base.slice(at, edit.from), ...edit.lines);
    at = edit.to;
  }
  out.push(...base.slice(at));
  return out.join("");
}

const ROUNDS = 250;

describe("mergeText property test", () => {
  /** Edits over [0, size): each in its own stretch of base lines, with at least one unchanged line between two edits. */
  function randomEdits(rng: () => number, size: number, tag: string, allowed: (index: number) => boolean): Edit[] {
    const edits: Edit[] = [];
    let at = 0;
    while (at < size) {
      at += Math.floor(rng() * 4);
      if (at >= size) break;
      const length = Math.floor(rng() * 3);
      const to = Math.min(size, at + length);
      const fresh = Array.from({ length: Math.floor(rng() * 3) }, (_, n) => `${tag} ${edits.length}.${n} ${Math.floor(rng() * 1e9)}\n`);
      let inside = true;
      for (let line = at; line < Math.max(to, at + 1); line += 1) inside = inside && allowed(line);
      if (inside && (to > at || fresh.length > 0)) edits.push({ from: at, to, lines: fresh });
      // One unchanged line at least before the next edit.
      at = Math.max(to, at) + 1;
    }
    return edits;
  }

  it(`holds the four laws of a merge in ${ROUNDS} random rounds`, () => {
    let disjoint = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const seed = 7000 + round;
      const rng = random(seed);
      const size = 1 + Math.floor(rng() * 40);
      const base = Array.from({ length: size }, (_, n) => `base line ${n} ${Math.floor(rng() * 1e9)}\n`);
      const baseText = base.join("");
      const x = apply(base, randomEdits(rng, size, "x", () => true));
      const note = `seed ${seed}`;

      expect(merged(mergeText(baseText, x, baseText)), note).toBe(x);
      expect(merged(mergeText(baseText, baseText, x)), note).toBe(x);
      expect(merged(mergeText(baseText, x, x)), note).toBe(x);

      // Disjoint edit sets: ours edits the lines in even blocks of eight, theirs those in odd blocks, with a gap of one
      // unchanged line kept between the two sets. The merge is both sets applied.
      const block = (line: number): number => Math.floor(line / 8);
      const ourEdits = randomEdits(rng, size, "ours", (line) => block(line) % 2 === 0 && line % 8 < 7);
      const theirEdits = randomEdits(rng, size, "theirs", (line) => block(line) % 2 === 1 && line % 8 < 7);
      const result = mergeText(baseText, apply(base, ourEdits), apply(base, theirEdits));
      const both = [...ourEdits, ...theirEdits].sort((a, b) => a.from - b.from || a.to - b.to);
      // An insertion at the boundary of a block (from === to === 8k) belongs to the block before it: skip rounds where the
      // two sets touch, which the "disjoint" law does not cover.
      const touching = both.some((edit, index) => index > 0 && (both[index - 1]?.to ?? -1) >= edit.from);
      if (!touching && ourEdits.length > 0 && theirEdits.length > 0) {
        disjoint += 1;
        expect(merged(result), note).toBe(apply(base, both));
      }
    }
    // The fourth law was really exercised, in most rounds.
    expect(disjoint).toBeGreaterThan(ROUNDS / 3);
  });
});
