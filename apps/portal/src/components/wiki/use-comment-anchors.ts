// The link between the comments and the rendered page: what the person selected (inside one block, under which heading) and
// where the passages of the comments are drawn. Highlights use the browser's CSS Custom Highlight API, so the page that React
// rendered is never changed; a browser without it shows the list and the quotes only.

import { type RefObject, useEffect, useState } from "react";
import { checkSelection, type CommentView, findQuote, QUOTE_MAX } from "@/lib/wiki-comments";

const BLOCK = "p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, pre, dt, dd";
const HEADING = /^H[1-6]$/;

/** A selection the person may comment on, or why not. */
export interface SelectedPassage {
  exact: string;
  /** The id of the heading the passage is under, or null when it comes before the first heading. */
  node: string | null;
  prefix: string;
  suffix: string;
}

export type Selected = { passage: SelectedPassage } | { refusal: string } | null;

function blockOf(node: Node | null, root: HTMLElement): Element | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  const block = element?.closest(BLOCK) ?? null;
  return block !== null && root.contains(block) ? block : null;
}

/** The nearest heading above a block in the rendered page: the node a comment on it is anchored to. */
function headingAbove(block: Element, root: HTMLElement): string | null {
  let found: string | null = null;
  for (const heading of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (!HEADING.test(heading.tagName) || heading.id === "") continue;
    // A heading is above the block when it comes before it in the document (or is the block itself).
    if (heading === block || heading.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING) found = heading.id;
    else break;
  }
  return found;
}

/** What the current selection of the page comes to; null when nothing inside the page is selected. */
export function readSelection(root: HTMLElement): Selected {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const first = blockOf(range.startContainer, root);
  const last = blockOf(range.endContainer, root);
  const blocks = first !== null && first === last ? 1 : 2;
  const checked = checkSelection(selection.toString(), blocks);
  if (!checked.ok) return { refusal: checked.reason };
  const text = first?.textContent ?? "";
  const found = findQuote(text, checked.exact);
  return {
    passage: {
      exact: checked.exact.slice(0, QUOTE_MAX),
      node: first === null ? null : headingAbove(first, root),
      prefix: found === null ? "" : text.slice(Math.max(0, found.start - 64), found.start),
      suffix: found === null ? "" : text.slice(found.end, found.end + 64),
    },
  };
}

/** The selection of the page as it changes, for the Comment action (null while nothing is selected inside the page). */
export function useSelectedPassage(root: RefObject<HTMLElement | null>): Selected {
  const [selected, setSelected] = useState<Selected>(null);
  useEffect(() => {
    const changed = (): void => {
      const element = root.current;
      setSelected(element === null ? null : readSelection(element));
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [root]);
  return selected;
}

/** A range over a passage of a block, found across the block's text nodes (bold, links and code split a block into several). */
function rangeOf(block: Element, exact: string): Range | null {
  const found = findQuote(block.textContent ?? "", exact);
  if (found === null) return null;
  const range = document.createRange();
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let started = false;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && found.start < offset + length) {
      range.setStart(node, found.start - offset);
      started = true;
    }
    if (started && found.end <= offset + length) {
      range.setEnd(node, found.end - offset);
      return range;
    }
    offset += length;
  }
  return null;
}

/** The first block of the page, under the comment's heading when it has one, that holds the comment's passage. */
export function blockHolding(root: HTMLElement, comment: Pick<CommentView, "node" | "quote">): Range | null {
  if (comment.quote === null) return null;
  const blocks = [...root.querySelectorAll(BLOCK)].filter((block) => !block.querySelector(BLOCK));
  const under = comment.node === null ? blocks : blocks.filter((block) => headingAbove(block, root) === comment.node);
  for (const block of [...under, ...blocks]) {
    const range = rangeOf(block, comment.quote);
    if (range !== null) return range;
  }
  return null;
}

interface HighlightRegistry {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
}

const NAME = "wiki-comments";

/** Marks the passages of the anchored comments on the page (and clears the marks when the page or the comments change). */
export function useCommentHighlights(root: RefObject<HTMLElement | null>, comments: readonly CommentView[], ready: boolean): void {
  useEffect(() => {
    const registry = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
    const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const element = root.current;
    if (registry === undefined || HighlightCtor === undefined || element === null || !ready) return;
    const ranges = comments
      .filter((comment) => comment.status !== "orphaned" && !comment.deleted && !comment.resolved && comment.quote !== null)
      .map((comment) => blockHolding(element, comment))
      .filter((range): range is Range => range !== null);
    if (ranges.length > 0) registry.set(NAME, new HighlightCtor(...ranges));
    return () => registry.delete(NAME);
  }, [root, comments, ready]);
}

/** Scrolls the page to the passage of a comment. */
export function showPassage(root: HTMLElement | null, comment: Pick<CommentView, "node" | "quote">): void {
  if (root === null) return;
  const range = blockHolding(root, comment);
  const target = range?.startContainer instanceof Element ? range.startContainer : (range?.startContainer.parentElement ?? null);
  target?.scrollIntoView({ block: "center" });
}
