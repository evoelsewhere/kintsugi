// What the Brain page says about a node, its index and a search, kept apart from the view so it can be tested.
// The Brain (ADR-0091) is a tree an agent reasons over: these helpers name its parts the way the page shows them.

import { BRAIN_ROOT_ID, type BrainCitation, type BrainNodeKind, type BrainState, type BrainSummarySource, isBrainReferenceId } from "@kintsugi/domain";
import type { StatusTone } from "@/components/ui/status-dot";

export const BRAIN_KIND_LABEL: Record<BrainNodeKind, string> = {
  root: "Repository",
  folder: "Folder",
  document: "Document",
  section: "Section",
  card: "Card",
};

/** Where a summary comes from, for the reader deciding how much to trust it. */
export const SUMMARY_SOURCE_LABEL: Record<BrainSummarySource, string> = {
  "front-matter": "the document's own summary",
  facts: "its front matter",
  text: "its whole text",
  paragraph: "its first paragraph",
  fields: "the card's fields",
  list: "its first list",
  table: "its table",
  diagram: "its diagram",
  code: "its code block",
  readme: "the folder's README",
  layout: "the document layout",
  children: "what it contains",
  section: "its summary section",
  none: "nothing yet",
};

export const BRAIN_STATE: Record<BrainState, { label: string; tone: StatusTone; busy?: "pulse" }> = {
  off: { label: "Off", tone: "muted" },
  "not-built": { label: "Not built", tone: "muted" },
  queued: { label: "Queued", tone: "blue", busy: "pulse" },
  indexing: { label: "Building", tone: "blue", busy: "pulse" },
  ready: { label: "Ready", tone: "green" },
  failed: { label: "Failed", tone: "red" },
};

/** A citation as an agent writes it: `path:start-end@commit`. */
export function citationText(citation: BrainCitation): string {
  const lines = citation.lineStart === citation.lineEnd ? `${citation.lineStart}` : `${citation.lineStart}-${citation.lineEnd}`;
  return `${citation.path}:${lines}@${citation.commit.slice(0, 12)}`;
}

/** About four characters per token, shown short: 950, 12k, 1.2M. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * What the search box does with its text: a reference id, a node id or a path is looked up; anything else is
 * searched for as an exact string.
 */
export function searchIntent(text: string): "lookup" | "grep" {
  const value = text.trim().replace(/^`|`$/g, "");
  if (isBrainReferenceId(value) || value === BRAIN_ROOT_ID) return "lookup";
  return !/\s/.test(value) && (value.includes("/") || value.includes("#") || /\.md$/i.test(value)) ? "lookup" : "grep";
}

/** The node a link inside a rendered document points to: its section when it names an anchor, else the document. */
export function linkedNodeIds(path: string, anchor: string | undefined): string[] {
  return anchor === undefined || anchor === "" ? [path] : [`${path}#${anchor}`, path];
}
