/**
 * The anchor of a Markdown heading (ADR-0097 decision 3). The Brain builds section ids from it, and the portal's
 * renderer and the link checker use it, so a link `page.md#anchor` opens the same heading everywhere.
 *
 * It is GitHub's anchor (github-slugger's rule) of the heading's rendered text: link and image syntax, HTML tags
 * outside code and emphasis marks go; the text of code spans stays; the text is lowercased; everything but letters,
 * combining marks, numbers, `_`, `-` and the space goes; each space becomes `-`, none collapses and none is trimmed.
 * Repeated anchors of one document get `-1`, `-2`… until the anchor is free.
 */

/**
 * Plain text of inline Markdown: links keep their text, emphasis and code marks go. No part of a link or a tag runs past
 * the start of the next one, so a paragraph of `[`, `[a](` or `<` is read in linear time (T3-016).
 */
export function plainInlineText(text: string): string {
  return text
    .replace(/!\[[^[\]]*\]\([^)[]*\)/g, "")
    .replace(/\[([^[\]]*)\]\([^)[]*\)/g, "$1")
    .replace(/<[^<>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The characters of a heading the anchor reads: a longer one is cut, so a pathological line is read in bounded time. */
const HEADING_MAX = 4_000;

/** Stands for a `_` that is text, not an emphasis mark, while the rest of the heading is rendered. */
const LITERAL_UNDERSCORE = String.fromCodePoint(0xe000);

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * `text` with its code spans replaced by `onCode(inner)` and the rest by `onText(chunk)`. A span opens at a run of
 * backticks and closes at the next run of exactly as many; an unmatched run is plain text. Linear in the text.
 */
function mapCodeSpans(text: string, onText: (chunk: string) => string, onCode: (inner: string) => string): string {
  const runs: Array<{ start: number; length: number }> = [];
  for (let index = 0; index < text.length; ) {
    if (text[index] !== "`") {
      index += 1;
      continue;
    }
    const start = index;
    while (text[index] === "`") index += 1;
    runs.push({ start, length: index - start });
  }
  // The next run of the same length after each run, found from the right.
  const next: number[] = new Array<number>(runs.length).fill(-1);
  const seen = new Map<number, number>();
  for (let run = runs.length - 1; run >= 0; run -= 1) {
    const length = runs[run]?.length ?? 0;
    next[run] = seen.get(length) ?? -1;
    seen.set(length, run);
  }
  let out = "";
  let cursor = 0;
  for (let run = 0; run < runs.length; run += 1) {
    const open = runs[run];
    const closeIndex = next[run] ?? -1;
    const close = closeIndex >= 0 ? runs[closeIndex] : undefined;
    if (open === undefined || close === undefined || open.start < cursor) continue;
    out += onText(text.slice(cursor, open.start)) + onCode(text.slice(open.start + open.length, close.start));
    cursor = close.start + close.length;
    // Runs inside the span open nothing.
    while (run + 1 < runs.length && (runs[run + 1]?.start ?? Infinity) < cursor) run += 1;
  }
  return out + onText(text.slice(cursor));
}

/** The rendered text of Markdown outside code spans: links give their text; images, tags and emphasis marks nothing. */
function renderText(chunk: string): string {
  return chunk
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, (_, mark: string) => (mark === "_" ? LITERAL_UNDERSCORE : mark))
    .replace(/!\[[^[\]]{0,1000}\]\([^)[]{0,2048}\)/g, "")
    .replace(/\[([^[\]]{0,1000})\]\([^)[]{0,2048}\)/g, "$1")
    .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]{0,2048})?\/?>/g, "")
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? "")
    .replace(/(?<![\p{L}\p{N}_])(_{1,3})(?=[^\s_])([^]{1,2000}?)(?<=[^\s_])\1(?![\p{L}\p{N}_])/gu, "$2");
}

/** The anchor of a heading's raw text; `section` when nothing is left (a heading of only punctuation). */
export function headingSlug(heading: string): string {
  const text = mapCodeSpans(heading.trim().slice(0, HEADING_MAX), renderText, (inner) => inner.replaceAll("_", LITERAL_UNDERSCORE));
  const slug = text
    .replaceAll(LITERAL_UNDERSCORE, "_")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replaceAll(" ", "-");
  return slug === "" ? "section" : slug;
}

/** The anchors of one document: each is made unique among the ones already given or reserved. */
export interface HeadingSlugger {
  /** The slug of `heading`, numbered when it is taken (`a`, `a-1`, `a-1-1` for `A`, `A`, `A-1`). */
  slug(heading: string): string;
  /** `anchor` itself when it is free, else the first free `anchor-1`, `anchor-2`…; it is taken from then on. */
  reserve(anchor: string): string;
}

export function createHeadingSlugger(): HeadingSlugger {
  // The number last tried for each anchor, as github-slugger counts: a repeat costs one step, not one per earlier repeat.
  const taken = new Map<string, number>();
  const reserve = (anchor: string): string => {
    let candidate = anchor;
    while (taken.has(candidate)) {
      const suffix = (taken.get(anchor) ?? 0) + 1;
      taken.set(anchor, suffix);
      candidate = `${anchor}-${suffix}`;
    }
    taken.set(candidate, 0);
    return candidate;
  };
  return { slug: (heading) => reserve(headingSlug(heading)), reserve };
}
