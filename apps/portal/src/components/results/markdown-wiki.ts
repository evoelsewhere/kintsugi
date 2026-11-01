// The wiki steps of the Markdown renderer, as a rehype plugin on the hast tree: heading ids and GitHub alerts.

import { atxHeading, createHeadingSlugger, isBrainReferenceId, plainInlineText } from "@kintsugi/domain";

/** The part of a hast node the wiki step reads. */
export interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start: { offset?: number | undefined }; end: { offset?: number | undefined } } | undefined;
}

const HEADING = /^h[1-6]$/;
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/i;

/** The heading as written, without its `#` marks: what the Brain builds the section id from. Only `#` headings are sections there. */
function headingSource(source: string, node: HastNode): string | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return undefined;
  return atxHeading(source.slice(start, end).split("\n")[0] ?? "")?.text;
}

/** The reference id a card heading starts with (`RULE-INV01-0001: Round half up`), which the Brain uses as its anchor. */
function cardId(heading: string): string | undefined {
  const match = /^([^\s:]+)(?:\s*:\s*(.*))?$/.exec(plainInlineText(heading).replace(/`/g, ""));
  return match?.[1] !== undefined && isBrainReferenceId(match[1]) ? match[1] : undefined;
}

/** `> [!NOTE]` on its own first line: the quote becomes an alert, and the marker leaves its text. */
function markAlert(quote: HastNode): void {
  const paragraph = (quote.children ?? []).find((child) => child.type === "element");
  const text = paragraph?.tagName === "p" ? paragraph.children?.[0] : undefined;
  const marker = text?.type === "text" ? ALERT_MARKER.exec(text.value ?? "") : null;
  if (paragraph === undefined || text === undefined || marker?.[1] === undefined) return;
  text.value = (text.value ?? "").slice(marker[0].length);
  const content = paragraph.children ?? [];
  if (text.value === "") content.shift();
  if (content.length === 0) quote.children = (quote.children ?? []).filter((child) => child !== paragraph);
  quote.properties = { ...quote.properties, dataAlert: marker[1].toLowerCase() };
}

/**
 * A rehype step for wiki documents. It gives each `#` heading, in document order, the id the Brain builder gives its
 * section (one slugger per document, a card's reference id first claiming its name). The Brain makes no section of a
 * document's single first `#` heading, its title, nor of an underlined heading, so those get no id and take no number.
 * It also marks a top-level quote that is a GitHub alert with `dataAlert`. Nothing in the document is run or fetched.
 */
export function wikiMarkdown() {
  return (tree: HastNode, file: { value: unknown }): void => {
    const source = typeof file.value === "string" ? file.value : String(file.value);
    const headings: Array<{ node: HastNode; text: string; level: number }> = [];
    const visit = (node: HastNode): void => {
      if (node.type === "element" && node.tagName !== undefined && HEADING.test(node.tagName)) {
        const text = headingSource(source, node);
        if (text !== undefined) headings.push({ node, text, level: Number(node.tagName.slice(1)) });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
    const levelOnes = headings.filter((heading) => heading.level === 1);
    const title = levelOnes.length === 1 && levelOnes[0] === headings[0] ? levelOnes[0] : undefined;
    const slugger = createHeadingSlugger();
    for (const heading of headings) {
      if (heading === title) continue;
      const card = cardId(heading.text);
      heading.node.properties = { ...heading.node.properties, id: card !== undefined ? slugger.reserve(card) : slugger.slug(heading.text) };
    }
    for (const child of tree.children ?? []) if (child.type === "element" && child.tagName === "blockquote") markAlert(child);
  };
}

/** The text of a hast node's descendants. */
export function textOf(node: HastNode): string {
  return node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join("");
}
