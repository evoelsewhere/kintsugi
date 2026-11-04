/**
 * Where an inline comment sits in a page (COL-02, ADR-0099 decisions 1 and 2). A comment is a row in Postgres, never a
 * line of Git, so the page can change under it: it keeps the quote it was made on and the section it was made in, and is
 * placed again from the quote when the page is read. A quote that is still there is found again (`anchored`), one that
 * moved to another section is found there (`moved`), and one that is gone leaves the comment shown at the end of the page
 * with its quote (`orphaned`). Nothing is fuzzy: the quote is there or it is not.
 *
 * The quote is the **text a reader sees**, because it comes from a selection in the rendered page: `plainTextOf` makes that
 * text out of Markdown lines, and `createAnchor` and `reanchor` work on it, so the server that checks a quote and the one that
 * places it again agree with the browser that made it. All of it is pure and never throws.
 */

import { textLines } from "./text-merge.js";

/** The longest quote of a comment, and the longest context kept on each side of it. */
export const ANCHOR_EXACT_MAX = 500;
export const ANCHOR_CONTEXT_MAX = 64;

/** What a comment keeps of its place: the section (a heading's anchor or a card's id), the quote and what surrounded it. */
export interface CommentAnchor {
  node: string;
  exact: string;
  prefix: string;
  suffix: string;
}

/** A part of the plain text of a page: where the text of a Markdown block came from. */
interface PlainBlock {
  /** The text a reader sees of the block, whitespace made single spaces. */
  text: string;
  /** The source line the block starts on, counted from 1 in the lines given. */
  line: number;
}

const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+/;
const TABLE_ROW = /^[ \t]*\|.*\|[ \t]*$/;
const TABLE_SEPARATOR = /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;
const RULE = /^[ \t]{0,3}(?:-[ \t]*){3,}$|^[ \t]{0,3}(?:\*[ \t]*){3,}$|^[ \t]{0,3}(?:_[ \t]*){3,}$/;
/** Every quote mark at the start of a line, in one match (a loop that cut one at a time is the square of the line). */
const QUOTES = /^(?:[ \t]{0,3}>[ \t]?)+/;

/** The pieces of a line of Markdown: the code spans (`code: true`, written without their back ticks) and the rest. */
function splitCode(text: string): Array<{ text: string; code: boolean }> {
  const pieces: Array<{ text: string; code: boolean }> = [];
  let plain = 0;
  for (let at = 0; at < text.length; ) {
    if (text[at] !== "`") {
      at += 1;
      continue;
    }
    let run = 0;
    while (text[at + run] === "`") run += 1;
    // The span closes at the next run of exactly as many back ticks.
    let close = -1;
    for (let next = text.indexOf("`", at + run); next >= 0; ) {
      let length = 0;
      while (text[next + length] === "`") length += 1;
      if (length === run) {
        close = next;
        break;
      }
      next = text.indexOf("`", next + length);
    }
    if (close < 0) {
      at += run;
      continue;
    }
    pieces.push({ text: text.slice(plain, at), code: false }, { text: text.slice(at + run, close).trim(), code: true });
    at = close + run;
    plain = at;
  }
  pieces.push({ text: text.slice(plain), code: false });
  return pieces;
}

/** An escaped character stands as a private-use character (this plus its code) while the marks around it are removed. */
const ESCAPED_BASE = 0xe100;
const ESCAPED = new RegExp("[" + String.fromCharCode(ESCAPED_BASE) + "-" + String.fromCharCode(ESCAPED_BASE + 0x7f) + "]", "g");

/**
 * How much of a page's inline marks are read. The patterns that match a link or a pair of marks look ahead for their end, so
 * a text of many opening marks without closing ones costs the square of its length; a page may be 5 MiB, anyone with
 * `wiki.write` writes it, and the server reads it for every reader of a comment. So marks are read in pieces of at most
 * `INLINE_CHUNK` characters (a mark that spans two pieces stays as written), and a page has `INLINE_WORK` steps to spend on
 * them, a piece costing its length times its opening marks: a page of prose and ordinary markup, however long, stays far
 * inside it, text made of opening marks is read for the first part of it and kept as written after that.
 */
const INLINE_CHUNK = 2000;
const INLINE_WORK = 15_000_000;
const OPENING_MARKS = /[[!*_~<`\\]/g;

/** A run of white space that is not one space (the only ones that need a change: a text of single spaces is not copied). */
const ODD_SPACE = /\s{2,}|[^\S ]/g;

/** What is left of the work to read marks, shared by the blocks of one page. */
interface InlineBudget {
  left: number;
}

/** The text of a piece of inline Markdown as a reader sees it: links and images by their text, no emphasis marks, code as written. */
function plainChunk(text: string): string {
  return splitCode(text)
    .map((piece) => {
      if (piece.code) return piece.text;
      return piece.text
        .replace(/\\([\\`*_{}[\]()#+.!|<>~-])/g, (_match, char: string) => String.fromCharCode(ESCAPED_BASE + char.charCodeAt(0)))
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
        .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
        .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1")
        .replace(/(?<![\w])__(?=\S)(.+?)(?<=\S)__(?![\w])/g, "$1")
        .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1")
        .replace(/(?<![\w])_(?=\S)(.+?)(?<=\S)_(?![\w])/g, "$1")
        .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "$1")
        .replace(ESCAPED, (char) => String.fromCharCode(char.charCodeAt(0) - ESCAPED_BASE));
    })
    .join("");
}

/** The text of a line (or lines) of inline Markdown as a reader sees it, the marks read within the limits above. */
function plainInline(text: string, budget: InlineBudget): string {
  const spaced = text.replace(ODD_SPACE, " ");
  if (budget.left <= 0) return spaced.trim();
  let out = "";
  for (let at = 0; at < spaced.length; ) {
    let chunk = spaced.slice(at, at + INLINE_CHUNK);
    if (at + chunk.length < spaced.length) {
      // Cut at a space when there is one in the piece (the search stays inside it: it never runs back over the whole text).
      const space = chunk.lastIndexOf(" ");
      if (space > 0) chunk = chunk.slice(0, space + 1);
    }
    const end = at + chunk.length;
    const marks = chunk.match(OPENING_MARKS)?.length ?? 0;
    if (marks > 0 && budget.left > 0) {
      budget.left -= chunk.length * (1 + marks);
      out += plainChunk(chunk);
    } else out += chunk;
    at = end;
  }
  return out.replace(ODD_SPACE, " ").trim();
}

/** The cells of a table row, as the reader shows them: each trimmed, empty ones left out, one space between. */
function tableRowText(line: string, budget: InlineBudget): string {
  // With no work left the cells are read as written: the same text, without a call for each of a million cells.
  if (budget.left <= 0) return line.trim().replace(/^\|/, "").replace(/\|$/, "").replace(/\|/g, " ").replace(/\s+/g, " ").trim();
  return plainInline(
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => plainInline(cell, budget))
      .filter((cell) => cell !== "")
      .join(" "),
    budget,
  );
}

/** The blocks of a page's text a reader sees, with the line each starts on. Front matter is not part of the page. */
function plainBlocks(lines: readonly string[]): PlainBlock[] {
  const blocks: PlainBlock[] = [];
  const budget: InlineBudget = { left: INLINE_WORK };
  let paragraph: { text: string[]; line: number } | undefined;
  let fence: string | undefined;
  const flush = (): void => {
    if (paragraph !== undefined) {
      const text = plainInline(paragraph.text.join(" "), budget);
      if (text !== "") blocks.push({ text, line: paragraph.line });
    }
    paragraph = undefined;
  };
  let index = 0;
  if ((lines[0] ?? "").replace(/\r$/, "").trim() === "---") {
    for (let end = 1; end < lines.length && end <= 400; end += 1) {
      if ((lines[end] ?? "").replace(/\r$/, "").trim() === "---") {
        index = end + 1;
        break;
      }
    }
  }
  for (; index < lines.length; index += 1) {
    const raw = (lines[index] ?? "").replace(/\r?\n?$/, "");
    const line = index + 1;
    const open = FENCE.exec(raw);
    if (fence !== undefined) {
      if (open?.[1] !== undefined && open[1][0] === fence[0] && open[1].length >= fence.length && raw.trim() === open[1]) fence = undefined;
      else {
        // The lines of a code block are shown as written, each a block of its own.
        const code = raw.replace(/\s+/g, " ").trim();
        if (code !== "") blocks.push({ text: code, line });
      }
      continue;
    }
    if (open?.[1] !== undefined) {
      flush();
      fence = open[1];
      continue;
    }
    if (raw.trim() === "" || RULE.test(raw) || /^\s*<!--.*-->\s*$/.test(raw)) {
      flush();
      continue;
    }
    if (TABLE_ROW.test(raw) || (raw.includes("|") && TABLE_SEPARATOR.test(raw) && /-/.test(raw))) {
      flush();
      if (TABLE_SEPARATOR.test(raw) && !/[^\s|:-]/.test(raw)) continue;
      const text = tableRowText(raw, budget);
      if (text !== "") blocks.push({ text, line });
      continue;
    }
    let text = raw;
    text = text.replace(QUOTES, "");
    if (HEADING.test(text)) {
      flush();
      const heading = plainInline(text.replace(HEADING, "").replace(/[ \t]+#+[ \t]*$/, ""), budget);
      if (heading !== "") blocks.push({ text: heading, line });
      continue;
    }
    if (LIST_ITEM.test(text)) {
      flush();
      paragraph = { text: [text.replace(LIST_ITEM, "")], line };
      continue;
    }
    if (paragraph === undefined) paragraph = { text: [text], line };
    else paragraph.text.push(text);
  }
  flush();
  return blocks;
}

/**
 * The text a reader sees of Markdown lines: a link by its text, an image by its alt text, no emphasis marks, back ticks,
 * table pipes, separator rows, list markers or `>`, no front matter, every run of white space one space, the blocks of the
 * page (paragraphs, list items, headings, table rows, lines of code) one per line.
 */
export function plainTextOf(lines: readonly string[]): string {
  return plainBlocks(lines).map((block) => block.text).join("\n");
}

/** A selection of the plain text of a page: `start` is the first character, `end` the one after the last. */
export interface AnchorRange {
  start: number;
  end: number;
}

/** The text of a page as lines, given as text or as lines. */
const linesOf = (page: string | readonly string[]): readonly string[] => (typeof page === "string" ? textLines(page) : page);

/**
 * The anchor of a selection of the plain text of the page (`plainTextOf` of its lines) in the section `node`: the quote,
 * at most 500 characters, and up to 64 characters of the plain text before and after it, taken from the whole page. The
 * range is held inside the text; an empty selection gives an empty quote, which the caller refuses.
 */
export function createAnchor(pageText: string | readonly string[], range: AnchorRange, node: string): CommentAnchor {
  const plain = plainTextOf(linesOf(pageText));
  const start = Math.max(0, Math.min(plain.length, Math.floor(range.start)));
  const end = Math.max(start, Math.min(plain.length, Math.floor(range.end)));
  const cut = Math.min(end, start + ANCHOR_EXACT_MAX);
  return {
    node,
    exact: plain.slice(start, cut),
    prefix: plain.slice(Math.max(0, start - ANCHOR_CONTEXT_MAX), start),
    suffix: plain.slice(cut, Math.min(plain.length, cut + ANCHOR_CONTEXT_MAX)),
  };
}

/** A section of the page as the Brain knows it: its anchor, and the lines of its own text (from 1, both included). */
export interface AnchorSection {
  anchor: string;
  lineStart: number;
  lineEnd: number;
}

export type Reanchored =
  /** The quote is in the section it was made in: where, as a line of the source and as offsets in the plain text of the page. */
  | { status: "anchored"; line: number; start: number; end: number }
  /** The quote is no longer in that section but is elsewhere in the page. */
  | { status: "moved"; line: number; start: number; end: number }
  /** The quote is nowhere in the page. */
  | { status: "orphaned" };

/** Runs of white space as the quote was made: single spaces within a block, a newline between blocks. */
const normalised = (text: string): string => text.replace(/[ \t\r\f\v]+/g, " ").replace(/ ?\n ?/g, "\n").trim();

/** The most places of a quote that are weighed: a quote of one letter in a page of millions is not told apart from the first thousands. */
const PLACES_MAX = 2000;

/** The first `PLACES_MAX` places `needle` is in `text`, as the offset of its first character. */
function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  if (needle === "") return found;
  for (let at = text.indexOf(needle); at >= 0 && found.length < PLACES_MAX; at = text.indexOf(needle, at + 1)) found.push(at);
  return found;
}

/** How many characters of `before` match the end of the context before the quote and of `after` its start. */
function contextScore(before: string, after: string, anchor: CommentAnchor): number {
  // A stored anchor is data from a database: a missing context is an empty one.
  const prefix = typeof anchor.prefix === "string" ? anchor.prefix : "";
  const suffix = typeof anchor.suffix === "string" ? anchor.suffix : "";
  let score = 0;
  while (score < before.length && score < prefix.length && before[before.length - 1 - score] === prefix[prefix.length - 1 - score]) score += 1;
  let tail = 0;
  while (tail < after.length && tail < suffix.length && after[tail] === suffix[tail]) tail += 1;
  return score + tail;
}

/** A page's text prepared for placing quotes in it: its plain blocks and where each starts in the plain text of the whole page. */
interface PreparedPage {
  lines: readonly string[];
  blocks: PlainBlock[];
  offsets: number[];
  whole: string;
}

function preparePage(pageText: string | readonly string[]): PreparedPage {
  const lines = linesOf(pageText);
  const blocks = plainBlocks(lines);
  const offsets: number[] = [];
  let total = 0;
  for (const block of blocks) {
    offsets.push(total);
    total += block.text.length + 1;
  }
  return { lines, blocks, offsets, whole: blocks.map((block) => block.text).join("\n") };
}

function placeQuote(page: PreparedPage, anchor: CommentAnchor, sections: readonly AnchorSection[], options: { near?: number }): Reanchored {
  const { lines, blocks, offsets, whole } = page;
  const exact = normalised(anchor.exact);
  if (exact === "" || blocks.length === 0) return { status: "orphaned" };

  const locate = (from: number, to: number): { start: number; end: number; line: number } | undefined => {
    const region = blocks.map((block, at) => ({ block, at })).filter(({ block }) => block.line >= from && block.line <= to);
    const first = region[0];
    if (first === undefined) return undefined;
    const base = offsets[first.at] ?? 0;
    const text = region.map(({ block }) => block.text).join("\n");
    const places = occurrences(text, exact);
    if (places.length === 0) return undefined;
    const scored = places.map((place) => {
      const start = base + place;
      const end = start + exact.length;
      return { start, end, score: contextScore(whole.slice(Math.max(0, start - ANCHOR_CONTEXT_MAX), start), whole.slice(end, end + ANCHOR_CONTEXT_MAX), anchor) };
    });
    const best = scored.reduce((most, place) => Math.max(most, place.score), 0);
    const candidates = scored.filter((place) => place.score === best);
    const near = options.near;
    const chosen = near === undefined ? candidates[0] : candidates.reduce((closest, place) => (Math.abs(place.start - near) < Math.abs(closest.start - near) ? place : closest));
    if (chosen === undefined) return undefined;
    const block = blocks.reduce((found, candidate, at) => ((offsets[at] ?? 0) <= chosen.start ? candidate : found), blocks[0] as PlainBlock);
    return { start: chosen.start, end: Math.min(chosen.end, whole.length), line: block.line };
  };

  const section = sections.find((candidate) => candidate.anchor === anchor.node);
  if (section !== undefined) {
    const inside = locate(section.lineStart, section.lineEnd);
    if (inside !== undefined) return { status: "anchored", ...inside };
  } else if (anchor.node === "") {
    const everywhere = locate(1, lines.length);
    if (everywhere !== undefined) return { status: "anchored", ...everywhere };
  }
  const elsewhere = locate(1, lines.length);
  return elsewhere === undefined ? { status: "orphaned" } : { status: "moved", ...elsewhere };
}

/**
 * Finds where a comment's quote is in the page now. `sections` are the Brain's sections of the page at the commit read,
 * so the quote is looked for in its own section first, then in the whole page. One place is that place; several: the
 * one whose surroundings match the anchor's best, and on a tie the one nearest `options.near` (an offset in the plain text
 * of the page, where the quote was seen last) or the first. It never throws and never answers a place outside the text.
 */
export function reanchor(pageText: string | readonly string[], anchor: CommentAnchor, sections: readonly AnchorSection[], options: { near?: number } = {}): Reanchored {
  try {
    return placeQuote(preparePage(pageText), anchor, sections, options);
  } catch {
    return { status: "orphaned" };
  }
}

/**
 * The places of many quotes of one page, in the order of `anchors`: each as `reanchor` gives it, but the page is read once
 * (reading it is most of the work, and a page may have a hundred comments).
 */
export function reanchorAll(pageText: string | readonly string[], anchors: readonly CommentAnchor[], sections: readonly AnchorSection[]): Reanchored[] {
  let page: PreparedPage;
  try {
    page = preparePage(pageText);
  } catch {
    return anchors.map(() => ({ status: "orphaned" }));
  }
  return anchors.map((anchor) => {
    try {
      return placeQuote(page, anchor, sections, {});
    } catch {
      return { status: "orphaned" };
    }
  });
}
