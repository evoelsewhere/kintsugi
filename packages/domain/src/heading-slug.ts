/**
 * The anchor of a Markdown heading (ADR-0097 decision 3). The Brain builds section ids from it, and the portal's
 * renderer and the link checker use it, so a link `page.md#anchor` opens the same heading everywhere.
 *
 * It is the GitHub-style anchor the Brain has always made: inline Markdown goes to its plain text, the text is
 * lowercased, everything but letters, numbers, whitespace, `_` and `-` is dropped and each space becomes `-`.
 * Where this differs from GitHub (a double space, HTML inside code, `_emphasis_`, combining marks) is measured in
 * `heading-slug.test.ts`; closing the gap changes section ids, so it is its own change.
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

/** The anchor of a heading's raw text; `section` when nothing is left (a heading of only punctuation). */
export function headingSlug(heading: string): string {
  const slug = plainInlineText(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
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
  const used = new Set<string>();
  const reserve = (anchor: string): string => {
    let candidate = anchor;
    for (let suffix = 1; used.has(candidate); suffix += 1) candidate = `${anchor}-${suffix}`;
    used.add(candidate);
    return candidate;
  };
  return { slug: (heading) => reserve(headingSlug(heading)), reserve };
}
