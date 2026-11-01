// The deterministic wiki eval of the Brain (ADR-0097 decision 10): how well the Brain's own builder and the line search
// reach the pages a wiki reader asks for. No model is called: each question is answered by the reads an agent has
// (tree order, node attributes, links, grep) and scored against the pages the key names. A score is between 0 and 1
// and higher is better; a cost is a count and lower is better. The recorded baseline (`wiki-baseline.json`) is what a
// later builder must not fall below.

import { BRAIN_BUILDER_VERSION, BRAIN_ROOT_ID, type BrainNode, type BrainSourceDocument, type BrainTree, buildBrainTree, isBrainIndexedPath } from "@kintsugi/domain";

/** `brain_grep` returns at most this many lines (the API's GREP_LIMIT). */
export const GREP_LIMIT = 50;

interface Pages {
  /** Pages the question asks for, by path. */
  expect: string[];
}

export type WikiQuestion = { id: string; kind: string; question: string } & Record<string, unknown>;

export interface WikiKey {
  fixture: string;
  questions: WikiQuestion[];
}

/** One question's result: the scores of each way of answering it, and what the reads cost. */
export interface WikiResult {
  id: string;
  kind: string;
  scores: Record<string, number>;
  costs: Record<string, number>;
  /** The citations (`path:start-end`) of the nodes that hold the lines the key names as evidence; the lines are not found when a node does not hold them. */
  citations: string[];
}

export interface WikiReport {
  builderVersion: number;
  stats: {
    documents: number;
    nodes: number;
    folders: number;
    sections: number;
    summarised: number;
    /** The distinct links from one document to another page or heading, as the sources write them. */
    links: { resolved: number; unresolved: number };
    /** The links that name a heading, and how many of them reach a section node. */
    headingLinks: { resolved: number; total: number };
  };
  questions: WikiResult[];
}

/** Attributes the next builder puts on a node (ADR-0097 decision 1); undefined on a builder that does not. */
interface WikiAttributes {
  labels?: string[];
  status?: string | null;
  space?: string | null;
  template?: boolean;
}

const attributes = (node: BrainNode): WikiAttributes => node as BrainNode & WikiAttributes;

const documentsOf = (tree: BrainTree): BrainNode[] => tree.nodes.filter((node) => node.kind === "document");

const asSet = (values: Iterable<string>): Set<string> => new Set(values);

/** Precision and recall of a found set against the expected one; an empty expectation found empty is a full score. */
function overlap(found: Set<string>, expected: Set<string>): { precision: number; recall: number } {
  const hit = [...found].filter((value) => expected.has(value)).length;
  return { precision: found.size === 0 ? (expected.size === 0 ? 1 : 0) : hit / found.size, recall: expected.size === 0 ? 1 : hit / expected.size };
}

/** The deepest node whose own lines hold a line of a document, as `brain_grep` maps a hit. */
function nodeAt(tree: BrainTree, path: string, line: number): BrainNode | undefined {
  return tree.nodes
    .filter((node) => node.path === path && node.lineStart !== null && node.lineEnd !== null && node.lineStart <= line && node.lineEnd >= line)
    .sort((a, b) => b.depth - a.depth)[0];
}

/**
 * The paths `brain_grep` would show for a text: the lines of indexed documents that hold every word (a quoted text
 * is one phrase), case-insensitive, the first fifty. The API gets them from `git grep -F`, a substring match.
 */
export function grepPaths(sources: readonly BrainSourceDocument[], tree: BrainTree, text: string): { paths: Set<string>; lines: number } {
  const words = text.trim().split(/\s+/).filter((word) => word !== "").map((word) => word.toLowerCase());
  const hits: Array<{ path: string; line: number }> = [];
  for (const source of [...sources].sort((a, b) => a.path.localeCompare(b.path, "en"))) {
    if (!isBrainIndexedPath(source.path)) continue;
    source.text.split("\n").forEach((line, index) => {
      const lower = line.toLowerCase();
      if (words.every((word) => lower.includes(word))) hits.push({ path: source.path, line: index + 1 });
    });
  }
  const kept = hits.slice(0, GREP_LIMIT);
  return { paths: asSet(kept.filter((hit) => nodeAt(tree, hit.path, hit.line) !== undefined).map((hit) => hit.path)), lines: hits.length };
}

/** The order of a folder's entries as a reader of `brain_tree` sees them: `name/` for a folder, the file name for a document. */
export function entriesOf(tree: BrainTree, folder: string): string[] {
  const id = folder === "" ? BRAIN_ROOT_ID : `${folder}/`;
  const prefix = folder === "" ? "" : `${folder}/`;
  return tree.nodes
    .filter((node) => node.parentId === id)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((node) => `${node.path.slice(prefix.length)}${node.kind === "folder" ? "/" : ""}`);
}

/** Documents under a folder, by path. */
const under = (tree: BrainTree, folder: string): Set<string> => asSet(documentsOf(tree).filter((node) => node.path.startsWith(`${folder}/`)).map((node) => node.path));

/** The documents that link to a node, or to a section of it, by path. A page's own links do not count. */
function backlinks(tree: BrainTree, target: string): Set<string> {
  const pathOf = new Map(tree.nodes.map((node) => [node.id, node.path]));
  const found = new Set<string>();
  for (const link of tree.links) {
    if (link.kind !== "link") continue;
    const to = pathOf.get(link.toId);
    const from = pathOf.get(link.fromId);
    if (to === target && from !== undefined && from !== target) found.add(from);
  }
  return found;
}

/**
 * The links the builder knows point nowhere. Builder 5 drops a link it cannot resolve, so nothing of them is left
 * (`knowledge.brain_ref` keeps them from builder 6, ADR-0097 decision 6); read from the tree when it says so.
 */
function brokenLinks(tree: BrainTree): Array<{ from: string; target: string }> {
  const broken = (tree as BrainTree & { broken?: Array<{ from: string; target: string }> }).broken;
  return broken ?? [];
}

const summary = (node: BrainNode | undefined): string => node?.summary ?? "";

function answer(question: WikiQuestion, tree: BrainTree, sources: readonly BrainSourceDocument[]): Omit<WikiResult, "citations"> {
  const base = { id: question.id, kind: question.kind };
  const expect = new Set((question as unknown as Pages).expect ?? []);
  const byPath = new Map(documentsOf(tree).map((node) => [node.path, node]));
  switch (question.kind) {
    case "label": {
      const label = String(question.label);
      const attribute = asSet(documentsOf(tree).filter((node) => attributes(node).labels?.includes(label) === true).map((node) => node.path));
      const grep = grepPaths(sources, tree, label);
      const a = overlap(attribute, expect);
      const g = overlap(grep.paths, expect);
      return { ...base, scores: { attributeRecall: a.recall, attributePrecision: a.precision, grepRecall: g.recall, grepPrecision: g.precision }, costs: { grepLines: grep.lines } };
    }
    case "space": {
      const expected = under(tree, String(question.folder));
      const key = String(question.space);
      const attribute = asSet(documentsOf(tree).filter((node) => attributes(node).space === key).map((node) => node.path));
      const a = overlap(attribute, expected);
      const p = overlap(under(tree, String(question.folder)), expected);
      return { ...base, scores: { attributeRecall: a.recall, attributePrecision: a.precision, pathRecall: p.recall, pathPrecision: p.precision }, costs: {} };
    }
    case "order": {
      const first = question.first as string[];
      const entries = entriesOf(tree, String(question.folder));
      const hit = first.filter((name, index) => entries[index] === name).length;
      return { ...base, scores: { listedFirst: hit / first.length }, costs: {} };
    }
    case "retired": {
      const retired = asSet(documentsOf(tree).filter((node) => /^archived\b/i.test(node.summary) || /^superseded\b/i.test(node.summary)).map((node) => node.path));
      const attribute = asSet(documentsOf(tree).filter((node) => attributes(node).status === "archived").map((node) => node.path));
      const s = overlap(retired, expect);
      const a = overlap(attribute, expect);
      return { ...base, scores: { summaryRecall: s.recall, summaryPrecision: s.precision, attributeRecall: a.recall, attributePrecision: a.precision }, costs: {} };
    }
    case "template": {
      const bySummary = asSet(documentsOf(tree).filter((node) => node.summary.startsWith("Template.")).map((node) => node.path));
      const attribute = asSet(documentsOf(tree).filter((node) => attributes(node).template === true).map((node) => node.path));
      const s = overlap(bySummary, expect);
      const a = overlap(attribute, expect);
      return { ...base, scores: { summaryRecall: s.recall, summaryPrecision: s.precision, attributeRecall: a.recall, attributePrecision: a.precision }, costs: {} };
    }
    case "anchor": {
      const path = String(question.path);
      const anchors = asSet(tree.nodes.filter((node) => node.path === path && node.anchor !== null).map((node) => node.anchor ?? ""));
      const wanted = question.expect as string[];
      return { ...base, scores: { anchorsFound: wanted.filter((anchor) => anchors.has(anchor)).length / wanted.length }, costs: {} };
    }
    case "moved":
    case "heading-link": {
      const from = String(question.from);
      const to = String(question.to);
      const linked = tree.links.some((link) => link.kind === "link" && link.toId === to && tree.nodes.find((node) => node.id === link.fromId)?.path === from);
      return { ...base, scores: { resolved: linked ? 1 : 0 }, costs: {} };
    }
    case "backlinks": {
      const found = backlinks(tree, String(question.target));
      const o = overlap(found, expect);
      return { ...base, scores: { recall: o.recall, precision: o.precision }, costs: {} };
    }
    case "broken": {
      const wanted = question.expect as Array<{ from: string; target: string }>;
      const found = brokenLinks(tree);
      const hit = wanted.filter((entry) => found.some((candidate) => candidate.from === entry.from && candidate.target === entry.target)).length;
      return { ...base, scores: { recall: wanted.length === 0 ? 1 : hit / wanted.length, precision: found.length === 0 ? (wanted.length === 0 ? 1 : 0) : found.filter((candidate) => wanted.some((entry) => entry.from === candidate.from && entry.target === candidate.target)).length / found.length }, costs: {} };
    }
    case "search": {
      const grep = grepPaths(sources, tree, String(question.terms));
      const o = overlap(grep.paths, expect);
      return { ...base, scores: { recall: o.recall, precision: o.precision }, costs: { grepLines: grep.lines } };
    }
    case "descend": {
      const node = byPath.get(String(question.path));
      const chain: BrainNode[] = [];
      for (let at = node; at !== undefined && at.parentId !== null; at = tree.nodes.find((candidate) => candidate.id === at?.parentId)) chain.push(at);
      // A reader descends level by level reading each sibling's title and summary: the cost is those tokens.
      const cost = chain.reduce((total, step) => {
        const siblings = tree.nodes.filter((candidate) => candidate.parentId === step.parentId);
        return total + siblings.reduce((sum, sibling) => sum + Math.ceil((sibling.title.length + summary(sibling).length) / 4), 0);
      }, 0);
      const followable = chain.length > 0 && chain.every((step) => step.summary !== "");
      return { ...base, scores: { everyStepSummarised: followable ? 1 : 0 }, costs: { levels: chain.length, tokensToDescend: cost } };
    }
    default:
      throw new Error(`unknown question kind ${question.kind}`);
  }
}

interface Evidence {
  file: string;
  match: string;
}

/** The citation of the deepest node that holds the line with the text, or undefined when the line or the node is not there. */
function citationOf(tree: BrainTree, sources: readonly BrainSourceDocument[], anchor: Evidence): string | undefined {
  const lines = (sources.find((source) => source.path === anchor.file)?.text ?? "").split("\n");
  const line = lines.findIndex((text) => text.includes(anchor.match)) + 1;
  const node = line === 0 ? undefined : nodeAt(tree, anchor.file, line);
  return node?.lineStart == null || node.lineEnd == null ? undefined : `${node.path}:${node.lineStart}-${node.lineEnd}`;
}

/** Every relative Markdown link of the sources, once per page and target, and how many the tree resolved. */
function linkStats(tree: BrainTree, sources: readonly BrainSourceDocument[]): Pick<WikiReport["stats"], "links" | "headingLinks"> {
  const stored = new Map(tree.nodes.map((node) => [node.id, node]));
  const reached = new Set(tree.links.filter((link) => link.kind === "link").map((link) => `${stored.get(link.fromId)?.path}\n${link.toId}`));
  const seen = new Set<string>();
  const stats = { links: { resolved: 0, unresolved: 0 }, headingLinks: { resolved: 0, total: 0 } };
  for (const source of sources.filter((candidate) => isBrainIndexedPath(candidate.path))) {
    for (const match of source.text.matchAll(/(?<!!)\[[^\]]*\]\(([^)#\s]+\.md)(?:#([^)\s]*))?\)/g)) {
      const parts = source.path.split("/").slice(0, -1);
      for (const part of (match[1] ?? "").split("/")) {
        if (part === "..") parts.pop();
        else if (part !== ".") parts.push(part);
      }
      const target = parts.join("/");
      const anchor = match[2];
      const key = `${source.path}\n${target}#${anchor ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = anchor === undefined ? target : `${target}#${anchor}`;
      const resolved = reached.has(`${source.path}\n${id}`);
      stats.links[resolved ? "resolved" : "unresolved"] += 1;
      if (anchor !== undefined) {
        stats.headingLinks.total += 1;
        if (resolved) stats.headingLinks.resolved += 1;
      }
    }
  }
  return stats;
}

/** Builds the tree of the sources and answers every question of the key. */
export function runWikiEval(key: WikiKey, sources: readonly BrainSourceDocument[]): WikiReport {
  const tree = buildBrainTree(sources, "wiki-docs · main");
  const documents = documentsOf(tree);
  return {
    builderVersion: BRAIN_BUILDER_VERSION,
    stats: {
      documents: documents.length,
      nodes: tree.nodes.length,
      folders: tree.nodes.filter((node) => node.kind === "folder").length,
      sections: tree.nodes.filter((node) => node.kind === "section" || node.kind === "card").length,
      summarised: tree.nodes.filter((node) => node.kind !== "root" && node.summary !== "").length,
      ...linkStats(tree, sources),
    },
    questions: key.questions.map((question) => {
      const result = answer(question, tree, sources);
      const evidence = (question.evidence ?? []) as Evidence[];
      const citations = evidence.map((anchor) => citationOf(tree, sources, anchor));
      const found = citations.filter((citation) => citation !== undefined);
      return {
        ...result,
        scores: { ...result.scores, evidenceInNode: evidence.length === 0 ? 1 : found.length / evidence.length },
        citations: found,
      };
    }),
  };
}
