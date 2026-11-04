// The ranked search of the Brain (ADR-0097 decision 7): what a person types, and the hits the full-text index gives for it.

import type { BrainCrumb, BrainNode } from "@kintsugi/domain";

/** The longest search text, and the most hits one answer holds. */
export const SEARCH_TEXT_MAX = 200;
export const SEARCH_LIMIT_MAX = 20;
export const SEARCH_LIMIT_DEFAULT = 10;

/**
 * What the index is asked. `web`: the words as a person typed them with the operators of a web search (a phrase in quotes,
 * `-word`, `or`), every word needed. `any`: plain words, a page that holds some of them qualifies and one that holds more of
 * them, closer together, ranks higher: a question holds words the page that answers it does not.
 */
export type BrainSearchQuery = { kind: "web"; text: string } | { kind: "any"; terms: string[] };

/** What the index is asked: the words, narrowed to a space or a label, with or without the pages people do not read. */
export interface BrainSearchRequest {
  query: BrainSearchQuery;
  space: string | undefined;
  label: string | undefined;
  /** Archived pages and templates are left out unless this is set. */
  includeHidden: boolean;
  limit: number;
}

/** A node of the tree the index found, with its rank. */
export interface BrainSearchFound {
  node: BrainNode;
  rank: number;
}

/** What the index answers, and how many pages it left out for being archived or templates. */
export interface BrainSearchFounds {
  hits: BrainSearchFound[];
  leftOut: { archived: number; templates: number };
}

/** One hit as the portal reads it. */
export interface BrainSearchHit {
  node: BrainNode;
  breadcrumb: BrainCrumb[];
  summary: string;
  /** The first line of the node's own text that holds a word of the search, read from Git at the indexed commit; null when none does. */
  line: { number: number; text: string } | null;
  /** `path:start-end@commit`: where the passage is. */
  citation: string;
  rank: number;
}

export interface BrainSearchView {
  commit: string;
  hits: BrainSearchHit[];
  leftOut: { archived: number; templates: number };
}

/** Words that say nothing about what is searched for: a question's grammar. Left out of a plain search unless nothing else is left. */
const COMMON = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "we", "our", "my", "i", "it", "at", "by", "be", "is", "are", "was", "were", "do", "does", "did", "how", "what", "why", "when", "where", "which", "who", "can", "should", "this", "that", "these", "those", "there", "about", "from", "as", "if", "so", "us", "you", "your"]);

/** Whether the text uses the operators of a web search: a phrase in quotes, a word to leave out (`-word`), `or`. */
const hasOperators = (text: string): boolean => /"|(^|\s)-\S|(^|\s)or(\s|$)/i.test(text);

/** How the words of a search are asked of the index: as typed when they carry operators, else as plain words without the grammar of a question. */
export function searchQueryOf(text: string): BrainSearchQuery {
  if (hasOperators(text)) return { kind: "web", text };
  const words = searchWords(text);
  const meaningful = words.filter((word) => !COMMON.has(word));
  return { kind: "any", terms: meaningful.length > 0 ? meaningful : words };
}

/** The words of a search as a reader would find them in a line: lowercase letters and digits, no operators, no one-letter words. */
export function searchWords(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length > 1 && word !== "or"))];
}

/** The first line of `lines` from `start` to `end` (1-based, both included) that holds a word, with its number; null when none does. */
export function matchingLine(lines: readonly string[], start: number, end: number, words: readonly string[]): { number: number; text: string } | null {
  if (words.length === 0) return null;
  for (let number = Math.max(1, start); number <= Math.min(end, lines.length); number += 1) {
    const text = (lines[number - 1] ?? "").replace(/\r$/, "");
    const lower = text.toLowerCase();
    if (words.some((word) => lower.includes(word))) return { number, text: text.trim().slice(0, 300) };
  }
  return null;
}
