// The ranked search of the wiki (ADR-0097 decision 7): the shapes `GET brain/search` gives, how its hits become the
// results the reader shows, and what the search box does when the route is not there (an older API) or the Brain is not
// built: it asks `brain/grep` instead, as it did before. Nothing is stored in the browser.

import type { BrainGrepView, BrainNode } from "@kintsugi/domain";
import { isHiddenPage, nameOf, readableExcerpt, type SearchHit, searchHits, type SearchLine } from "./wiki";

/** One hit of `brain/search`: a page, a section or a card of it, best first. */
export interface RankedHit {
  node: BrainNode;
  /** Where the node is in the tree: the folders and the page above it. The API gives crumbs; plain titles are taken too. */
  breadcrumb: ReadonlyArray<{ kind?: string; title: string } | string>;
  summary: string;
  /** The first line of the node that holds a word of the query, read from Git at the indexed commit; null when none does. */
  line: { number: number; text: string } | null;
  /** `path:start-end@commit`: where the passage is, for a citation. */
  citation: string;
  rank: number;
}

export interface BrainSearchView {
  commit: string;
  hits: RankedHit[];
  /** What was left out because archived pages and templates are not part of what people read. */
  leftOut: { archived: number; templates: number };
}

/** What a search came to: ranked pages, or the lines of the exact text search the box falls back to. */
export type SearchOutcome = { kind: "ranked"; view: BrainSearchView } | { kind: "exact"; view: BrainGrepView };

/** The statuses that mean "this API cannot search ranked": the route is not there (an older API) or the Brain is not built. */
const FALLBACK_STATUSES: ReadonlySet<number> = new Set([404, 409]);

/**
 * Asks the ranked search and, when the route is not there (404) or the Brain is not built (409), the exact text search, with
 * no error shown. Any other failure is the API's own and is thrown as it is.
 */
export async function runSearch(ask: { search: () => Promise<BrainSearchView>; grep: () => Promise<BrainGrepView> }): Promise<SearchOutcome> {
  try {
    return { kind: "ranked", view: await ask.search() };
  } catch (failure) {
    const status = (failure as { status?: unknown } | null)?.status;
    if (typeof status !== "number" || !FALLBACK_STATUSES.has(status)) throw failure;
  }
  return { kind: "exact", view: await ask.grep() };
}

/** What `brain/search` takes: the most hits a person is shown, and whether archived pages and templates count. */
export const SEARCH_LIMIT = 20;

const titleOf = (crumb: RankedHit["breadcrumb"][number]): string => (typeof crumb === "string" ? crumb : crumb.title);
const kindOf = (crumb: RankedHit["breadcrumb"][number]): string | undefined => (typeof crumb === "string" ? undefined : crumb.kind);

/**
 * The hits as the reader's results: one entry per page, in the order of its best hit, each with the lines that matched
 * (a hit on a section or a card links to its heading). Archived pages and templates are left out unless asked for: they
 * only reach the list when the person chose to include them.
 */
export function rankedHits(hits: readonly RankedHit[], options: { includeHidden?: boolean } = {}): SearchHit[] {
  const pages = new Map<string, SearchHit>();
  for (const hit of hits) {
    if (!options.includeHidden && isHiddenPage(hit.node)) continue;
    const path = hit.node.path;
    let page = pages.get(path);
    if (page === undefined) {
      const crumbs = hit.breadcrumb.filter((crumb) => kindOf(crumb) !== "root");
      const own = hit.breadcrumb.find((crumb) => kindOf(crumb) === "document");
      page = {
        path,
        title: own === undefined ? (hit.node.kind === "document" ? hit.node.title : nameOf(path)) : titleOf(own),
        // Plain titles are the folders above the page; a crumb says its own kind.
        breadcrumb: crumbs.filter((crumb) => kindOf(crumb) === undefined || kindOf(crumb) === "folder").map(titleOf),
        space: hit.node.kind === "document" ? hit.node.space : null,
        labels: hit.node.kind === "document" ? hit.node.labels : [],
        lines: [],
        summary: "",
      };
      pages.set(path, page);
    }
    // The summary shown is that of the page when it was hit, or of the best node otherwise.
    if (page.summary === "" || hit.node.kind === "document") page.summary = hit.node.summary;
    if (hit.line !== null) {
      const inHeading = hit.node.kind === "section" || hit.node.kind === "card";
      const line: SearchLine = { line: hit.line.number, excerpt: readableExcerpt(hit.line.text), anchor: inHeading ? hit.node.anchor : null, section: inHeading ? hit.node.title : null };
      if (!page.lines.some((known) => known.line === line.line)) page.lines.push(line);
    } else if (hit.node.kind === "section" || hit.node.kind === "card") {
      // A hit without a line still points at its heading.
      page.lines.push({ line: hit.node.lineStart ?? 0, excerpt: hit.node.title, anchor: hit.node.anchor, section: null });
    }
  }
  return [...pages.values()];
}

/** How many archived pages and templates a result left out, in words; "" when none. */
export function leftOutNote(leftOut: BrainSearchView["leftOut"]): string {
  const parts = [leftOut.archived > 0 ? `${leftOut.archived} archived ${leftOut.archived === 1 ? "page" : "pages"}` : "", leftOut.templates > 0 ? `${leftOut.templates} ${leftOut.templates === 1 ? "template" : "templates"}` : ""].filter((part) => part !== "");
  return parts.length === 0 ? "" : `${parts.join(" and ")} not shown`;
}

/** The pages an outcome lists: the ranked ones, or the exact text matches grouped by page. */
export function outcomeHits(outcome: SearchOutcome | null | undefined, options: { includeHidden?: boolean } = {}): SearchHit[] {
  if (outcome === null || outcome === undefined) return [];
  return outcome.kind === "ranked" ? rankedHits(outcome.view.hits, options) : searchHits(outcome.view.matches);
}

/** The words of a query, for marking them in a line: each at least one character, once, the longest first, case ignored. */
export function queryWords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((word) => word !== "");
  return [...new Set(words)].sort((a, b) => b.length - a.length);
}

/** A text cut into the parts that are a word of the query and those that are not, for marking the words a ranked hit matched. */
export function highlightWords(text: string, query: string): Array<{ text: string; match: boolean }> {
  const words = queryWords(query);
  if (words.length === 0) return [{ text, match: false }];
  const pattern = new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "giu");
  const parts: Array<{ text: string; match: boolean }> = [];
  let at = 0;
  for (const found of text.matchAll(pattern)) {
    const index = found.index ?? 0;
    if (found[0] === "") continue;
    if (index > at) parts.push({ text: text.slice(at, index), match: false });
    parts.push({ text: found[0], match: true });
    at = index + found[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts.length === 0 ? [{ text, match: false }] : parts;
}
