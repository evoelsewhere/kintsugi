/**
 * The Brain (ADR-0091): a vectorless, reasoning-based index of one branch of the project's document repo.
 *
 * The index is a tree — folders, documents, their sections and their cards — with a short summary on every
 * node. An agent reads the summaries, decides where to descend and reads the nodes it picked; it cites what it
 * read by node id, path, lines and commit. Nothing is embedded, nothing is ranked by similarity and no model is
 * called to build the tree: titles and summaries come from the documents themselves (front matter, the first
 * paragraph, a table's columns, the layout). The text stays in Git; the tree holds line ranges into it.
 */
import { describeDocumentFolder } from "./document-layout.js";

export const BRAIN_NODE_KINDS = ["root", "folder", "document", "section", "card"] as const;
export type BrainNodeKind = (typeof BRAIN_NODE_KINDS)[number];

/** Where a node's summary comes from, so a reader knows how much to trust it. */
export const BRAIN_SUMMARY_SOURCES = [
  "front-matter", // the document's own `summary` or `description`
  "facts", // the document's front matter facts (`status: understood · rules: 12`)
  "text", // the node's whole text, short enough to be its own summary
  "paragraph", // the node's first paragraph, cut at a word
  "fields", // a card's field bullets
  "list", // the first items of a list
  "table", // a table's columns and row count
  "diagram", // a Mermaid diagram
  "code", // a code block
  "readme", // a folder's README.md or index.md
  "layout", // what the document layout says the folder holds
  "children", // the titles of the node's children
  "none",
] as const;
export type BrainSummarySource = (typeof BRAIN_SUMMARY_SOURCES)[number];

/** The id of the tree's root. A folder's id is its path with a trailing `/`, a document's its path, a section's `path#anchor`. */
export const BRAIN_ROOT_ID = "/";
/** Bumped when the builder changes what it produces, so every index is rebuilt once. */
export const BRAIN_BUILDER_VERSION = 2;
export const BRAIN_SUMMARY_MAX = 240;
export const BRAIN_TITLE_MAX = 200;
/** Larger files are left out, as the document read API refuses them (docs/reference/document-repo-read-path.md). */
export const BRAIN_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const BRAIN_MAX_DOCUMENTS = 20_000;
/** Headings beyond this stay text of the node before them. */
export const BRAIN_MAX_NODES_PER_DOCUMENT = 2_000;
/** Distinct links kept per node; ids mentioned by many documents would otherwise dominate the link table. */
export const BRAIN_MAX_LINKS_PER_NODE = 50;

export interface BrainNode {
  id: string;
  parentId: string | null;
  kind: BrainNodeKind;
  /** The document's path, or the folder's path without the trailing `/` ("" for the root). */
  path: string;
  anchor: string | null;
  title: string;
  summary: string;
  summarySource: BrainSummarySource;
  /** Position among its siblings, in reading order. */
  ordinal: number;
  /** Distance from the root. */
  depth: number;
  /** 1-based lines of the node's own text (its heading up to its first child or next heading); null for a folder. */
  lineStart: number | null;
  lineEnd: number | null;
  /** Last line of the node with everything under it. */
  subtreeEnd: number | null;
  /** About four characters per token: the node's own text, and with everything under it. */
  tokens: number;
  subtreeTokens: number;
  children: number;
  /** Reference identifiers the node defines: a card's heading id, or a document's front matter `id`. */
  ids: string[];
}

export interface BrainLink {
  fromId: string;
  toId: string;
  /** `link`: a Markdown link; `id`: a mention of an identifier another node defines. */
  kind: "link" | "id";
}

export interface BrainTree {
  nodes: BrainNode[];
  links: BrainLink[];
  documents: number;
  identifiers: number;
  /** Documents left out because the index reached its bound. */
  skipped: number;
}

export interface BrainSourceDocument {
  path: string;
  text: string;
}

const EXCLUDED_ROOTS = new Set(["plugins", "scratch", "restricted"]);
/** Allocation ledgers (ADR-0075) are machine-maintained history, not knowledge. */
const EXCLUDED_FOLDERS = new Set(["restricted", "identifiers"]);
const README_FILES = ["readme.md", "index.md"];

/**
 * Whether a repository path belongs in the index: Markdown documents outside member plugins, run scratch,
 * restricted records, identifier ledgers and hidden folders.
 */
export function isBrainIndexedPath(path: string): boolean {
  if (!path.toLowerCase().endsWith(".md")) return false;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.startsWith("."))) return false;
  if (EXCLUDED_ROOTS.has(segments[0] ?? "")) return false;
  return !segments.slice(0, -1).some((segment) => EXCLUDED_FOLDERS.has(segment));
}

/** Approximate model tokens of a text: about four characters each. */
export function brainTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function brainFolderId(path: string): string {
  return path === "" ? BRAIN_ROOT_ID : `${path}/`;
}

export function brainSectionId(path: string, anchor: string): string {
  return `${path}#${anchor}`;
}

/** The document path and anchor of a node id; a folder id gives its path and no anchor. */
export function parseBrainNodeId(id: string): { path: string; anchor: string | null } {
  if (id === BRAIN_ROOT_ID) return { path: "", anchor: null };
  if (id.endsWith("/")) return { path: id.slice(0, -1), anchor: null };
  const hash = id.indexOf("#");
  return hash < 0 ? { path: id, anchor: null } : { path: id.slice(0, hash), anchor: id.slice(hash + 1) };
}

/** A reference id: uppercase segments joined by `-`, ending in digits (`RULE-CARD01-0001`, `COM-LOG-01`, `API-001`). */
const ID_SOURCE = String.raw`[A-Z][A-Z0-9]{1,15}(?:-[A-Z0-9]{1,16})*-[0-9]{2,}[A-Z]?`;
const ID_PATTERN = new RegExp(`^${ID_SOURCE}$`);
const ID_MENTIONS = new RegExp(`(?<![A-Za-z0-9-])${ID_SOURCE}(?![A-Za-z0-9-])`, "g");
const CARD_HEADING = new RegExp(`^(${ID_SOURCE})(?:\\s*:\\s*(.*))?$`);
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const LINK = /(?<!!)\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;

export function isBrainReferenceId(value: string): boolean {
  return ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}

/** Plain text of inline Markdown: links keep their text, emphasis and code marks go. */
function plain(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** GitHub-style heading anchor; letters of any script are kept. */
export function brainAnchor(heading: string): string {
  const slug = plain(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
  return slug === "" ? "section" : slug;
}

interface FrontMatter {
  fields: Map<string, string>;
  /** Lines the front matter takes, including both `---` lines (0 when there is none). */
  lines: number;
}

function scalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // not JSON: shown as written
    }
  }
  return value;
}

/** Scalar facts between two `---` lines at the top (docs/reference/document-formats.md); block lists are skipped. */
function frontMatterOf(lines: readonly string[]): FrontMatter {
  const fields = new Map<string, string>();
  if (lines[0]?.trim() !== "---") return { fields, lines: 0 };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0 || end > 400) return { fields, lines: 0 };
  for (const line of lines.slice(1, end)) {
    const pair = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (pair?.[1] !== undefined && pair[2] !== undefined && pair[2].trim() !== "") fields.set(pair[1], scalar(pair[2]));
  }
  return { fields, lines: end + 1 };
}

/** Front matter facts too opaque to help a reader decide where to look. */
const OPAQUE_FACT = /^(digest|sources?|runid|commit|sha|hash|fingerprints?|specification|profile|generatedat|updatedat|createdat|anchor)$/i;

function factsOf(fields: Map<string, string>): string {
  const facts: string[] = [];
  for (const [key, value] of fields) {
    if (OPAQUE_FACT.test(key) || key === "title" || /^[0-9a-f]{16,}$/i.test(value) || value.length > 60) continue;
    facts.push(`${key}: ${value}`);
    if (facts.length === 6) break;
  }
  return facts.join(" · ");
}

interface Summary {
  summary: string;
  source: BrainSummarySource;
}

/** The blocks of a node's own text: runs of non-blank lines, code fences kept whole, HTML comments dropped. */
function blocksOf(lines: readonly string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  let fence: string | undefined;
  let comment = false;
  const flush = (): void => {
    if (current.length > 0) blocks.push(current);
    current = [];
  };
  for (const line of lines) {
    if (fence !== undefined) {
      current.push(line);
      if (line.trim().startsWith(fence)) {
        fence = undefined;
        flush();
      }
      continue;
    }
    if (comment) {
      if (line.includes("-->")) comment = false;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("<!--")) {
      if (!trimmed.includes("-->")) comment = true;
      continue;
    }
    const open = FENCE.exec(line);
    if (open?.[1] !== undefined) {
      flush();
      fence = open[1].slice(0, 3);
      current.push(line);
      continue;
    }
    if (trimmed === "") flush();
    else current.push(line);
  }
  flush();
  return blocks;
}

function cellsOf(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => plain(cell));
}

/**
 * What the rows of a table are about: the first cell of each row, with the second when the first is only a short
 * code (`R-03 Customer data exposed…`), so a reader of the tree sees which rows the table has.
 */
function tableKeys(block: readonly string[]): string {
  const rows = block.filter((line) => line.trim().startsWith("|")).slice(2).map(cellsOf);
  return rows
    .map(([key = "", next = ""]) => (key.length <= 8 && next !== "" ? `${key} ${next}` : key))
    .filter((key) => key !== "")
    .join("; ");
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const FIELD = /^\s*[-*+]\s+\*\*([^*]+?):?\*\*:?\s*(.*)$/;

function summaryOfBlock(block: readonly string[]): Summary | undefined {
  const first = block[0]?.trim() ?? "";
  const fence = FENCE.exec(block[0] ?? "");
  if (fence !== null) {
    const language = first.replace(/^[`~]+/, "").trim().split(/\s/)[0] ?? "";
    if (language === "mermaid") {
      const kind = block[1]?.trim().split(/[\s;]/)[0] ?? "";
      return { summary: kind === "" ? "Mermaid diagram." : `Mermaid diagram (${kind}).`, source: "diagram" };
    }
    return { summary: language === "" ? "Code block." : `Code block (${language}).`, source: "code" };
  }
  if (first.startsWith("|")) {
    const columns = cellsOf(first);
    const keys = tableKeys(block);
    const rows = Math.max(0, block.filter((line) => line.trim().startsWith("|")).length - 2);
    const head = `Table of ${rows} ${rows === 1 ? "row" : "rows"}: ${columns.join(", ")}.`;
    return { summary: clip(keys === "" ? head : `${head} Rows: ${keys}.`, BRAIN_SUMMARY_MAX), source: "table" };
  }
  if (FIELD.test(block[0] ?? "")) {
    const fields = block
      .map((line) => FIELD.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .slice(0, 6)
      .map((match) => `${plain(match[1] ?? "")}: ${plain(match[2] ?? "")}`);
    return { summary: clip(fields.join(" · "), BRAIN_SUMMARY_MAX), source: "fields" };
  }
  if (LIST_ITEM.test(block[0] ?? "")) {
    const items = block
      .map((line) => LIST_ITEM.exec(line)?.[1])
      .filter((item): item is string => item !== undefined)
      .map(plain);
    return { summary: clip(items.join("; "), BRAIN_SUMMARY_MAX), source: "list" };
  }
  if (/^(>|\s*<)/.test(first) && plain(block.join(" ").replace(/^>\s?/gm, "")) === "") return undefined;
  const text = plain(block.map((line) => line.replace(/^>\s?/, "")).join(" "));
  return text === "" ? undefined : { summary: clip(text, BRAIN_SUMMARY_MAX), source: "paragraph" };
}

/** The summary of a node's own text (its heading line excluded), or undefined when it has none. */
/** Prose says best what a node is about: a paragraph among the first blocks wins over a list, a table or a diagram before it. */
const PROSE_LOOKAHEAD = 4;

function summaryOfText(lines: readonly string[]): Summary | undefined {
  const blocks = blocksOf(lines);
  const found = blocks.map(summaryOfBlock);
  const prose = found.slice(0, PROSE_LOOKAHEAD).find((summary) => summary?.source === "paragraph");
  if (prose !== undefined) {
    if (blocks.length === 1 && plain(lines.join(" ")).length <= BRAIN_SUMMARY_MAX) return { summary: prose.summary, source: "text" };
    // A short introduction to a table says what the table is; its rows say what it holds.
    const table = blocks.slice(0, PROSE_LOOKAHEAD).find((block) => block[0]?.trim().startsWith("|"));
    const keys = table === undefined ? "" : tableKeys(table);
    return keys === "" ? prose : { summary: clip(`${prose.summary.replace(/[.:]$/, "")}. Rows: ${keys}.`, BRAIN_SUMMARY_MAX), source: "paragraph" };
  }
  return found.find((summary) => summary !== undefined);
}

function summaryOfChildren(titles: readonly string[]): Summary {
  if (titles.length === 0) return { summary: "", source: "none" };
  const shown = titles.slice(0, 8).join(" · ");
  return { summary: clip(titles.length > 8 ? `${shown} · and ${titles.length - 8} more` : shown, BRAIN_SUMMARY_MAX), source: "children" };
}

// ---------------------------------------------------------------------------
// One document
// ---------------------------------------------------------------------------

interface PendingLink {
  fromId: string;
  path?: string;
  anchor?: string;
  id?: string;
}

interface Heading {
  line: number; // 0-based
  level: number;
  text: string;
}

function headingsOf(lines: readonly string[], from: number): Heading[] {
  const headings: Heading[] = [];
  let fence: string | undefined;
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const open = FENCE.exec(line);
    if (fence !== undefined) {
      if (line.trim().startsWith(fence)) fence = undefined;
      continue;
    }
    if (open?.[1] !== undefined) {
      fence = open[1].slice(0, 3);
      continue;
    }
    const match = HEADING.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined && headings.length < BRAIN_MAX_NODES_PER_DOCUMENT) {
      headings.push({ line: index, level: match[1].length, text: match[2] });
    }
  }
  return headings;
}

function resolveTarget(fromPath: string, target: string): { path: string; anchor?: string } | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) return undefined;
  const hash = target.indexOf("#");
  const rawPath = hash < 0 ? target : target.slice(0, hash);
  const anchor = hash < 0 ? undefined : decodeURIComponent(target.slice(hash + 1));
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath.split("?")[0] ?? "");
  } catch {
    return undefined;
  }
  if (decoded === "") return anchor === undefined || anchor === "" ? undefined : { path: fromPath, anchor };
  const base = decoded.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (base.length === 0) return undefined;
      base.pop();
    } else base.push(segment);
  }
  const path = base.join("/");
  return path === "" ? undefined : anchor === undefined || anchor === "" ? { path } : { path, anchor };
}

function linksOf(fromId: string, fromPath: string, lines: readonly string[]): PendingLink[] {
  const found: PendingLink[] = [];
  const text = lines.join("\n");
  for (const match of text.matchAll(LINK)) {
    const target = resolveTarget(fromPath, match[2] ?? "");
    if (target !== undefined) found.push({ fromId, ...target });
  }
  for (const match of text.matchAll(ID_MENTIONS)) found.push({ fromId, id: match[0] });
  return found;
}

interface DocumentNodes {
  nodes: BrainNode[];
  links: PendingLink[];
}

/**
 * The nodes of one document: the document, then one node per heading (a card when the heading starts with a
 * reference id), in order. A single top-level `#` heading is the document's title, not a node of its own.
 * Depths, ordinals and parents below the document are set; the document's own are set by the tree.
 */
export function buildBrainDocument(path: string, text: string): DocumentNodes {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const front = frontMatterOf(lines);
  const headings = headingsOf(lines, front.lines);
  const topLevel = headings.filter((heading) => heading.level === 1);
  const titleHeading = topLevel.length === 1 && topLevel[0] === headings[0] ? topLevel[0] : undefined;
  const sections = titleHeading === undefined ? headings : headings.slice(1);
  const fileName = path.split("/").pop() ?? path;
  const title = clip(
    front.fields.get("title") ?? (titleHeading !== undefined ? plain(titleHeading.text) : fileName.replace(/\.md$/i, "")),
    BRAIN_TITLE_MAX,
  );

  const documentEnd = sections[0]?.line ?? lines.length; // exclusive, 0-based
  const ownStart = titleHeading !== undefined ? titleHeading.line + 1 : front.lines;
  const ownLines = lines.slice(ownStart, documentEnd);
  const documentIds = [front.fields.get("id")].filter((id): id is string => id !== undefined && isBrainReferenceId(id));
  const document: BrainNode = {
    id: path,
    parentId: null,
    kind: "document",
    path,
    anchor: null,
    title,
    summary: "",
    summarySource: "none",
    ordinal: 0,
    depth: 0,
    lineStart: 1,
    lineEnd: Math.max(1, documentEnd),
    subtreeEnd: Math.max(1, lines.length),
    tokens: brainTokens(lines.slice(0, documentEnd).join("\n")),
    subtreeTokens: brainTokens(lines.join("\n")),
    children: 0,
    ids: documentIds,
  };
  const nodes: BrainNode[] = [document];
  const links: PendingLink[] = linksOf(path, path, ownLines);

  const used = new Set<string>();
  const unique = (anchor: string): string => {
    let candidate = anchor;
    for (let suffix = 1; used.has(candidate); suffix += 1) candidate = `${anchor}-${suffix}`;
    used.add(candidate);
    return candidate;
  };
  const stack: Array<{ level: number; node: BrainNode }> = [];
  const childCount = new Map<string, number>();
  const childTitles = new Map<string, string[]>();
  for (const [index, heading] of sections.entries()) {
    const headingText = plain(heading.text);
    const card = CARD_HEADING.exec(headingText.replace(/`/g, ""));
    const id = card?.[1];
    const anchor = unique(id ?? brainAnchor(heading.text));
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= heading.level) stack.pop();
    const parent = stack[stack.length - 1]?.node ?? document;
    const next = sections[index + 1];
    const ownEnd = next?.line ?? lines.length; // exclusive
    const subtreeEndLine = sections.slice(index + 1).find((later) => later.level <= heading.level)?.line ?? lines.length;
    const ordinal = childCount.get(parent.id) ?? 0;
    childCount.set(parent.id, ordinal + 1);
    const nodeId = brainSectionId(path, anchor);
    const node: BrainNode = {
      id: nodeId,
      parentId: parent.id,
      kind: id !== undefined ? "card" : "section",
      path,
      anchor,
      title: clip(headingText, BRAIN_TITLE_MAX),
      summary: "",
      summarySource: "none",
      ordinal,
      depth: parent.depth + 1,
      lineStart: heading.line + 1,
      lineEnd: ownEnd,
      subtreeEnd: subtreeEndLine,
      tokens: brainTokens(lines.slice(heading.line, ownEnd).join("\n")),
      subtreeTokens: brainTokens(lines.slice(heading.line, subtreeEndLine).join("\n")),
      children: 0,
      ids: id !== undefined ? [id] : [],
    };
    const own = lines.slice(heading.line + 1, ownEnd);
    const summary = summaryOfText(own) ?? (card?.[2] !== undefined && card[2] !== "" ? { summary: clip(card[2], BRAIN_SUMMARY_MAX), source: "text" as const } : undefined);
    if (summary !== undefined) {
      node.summary = summary.summary;
      node.summarySource = summary.source;
    }
    childTitles.set(parent.id, [...(childTitles.get(parent.id) ?? []), node.title]);
    nodes.push(node);
    links.push(...linksOf(nodeId, path, own));
    stack.push({ level: heading.level, node });
  }

  for (const node of nodes) {
    node.children = childCount.get(node.id) ?? 0;
    if (node.summarySource === "none") Object.assign(node, toNode(summaryOfChildren(childTitles.get(node.id) ?? [])));
  }
  const ownSummary = front.fields.get("summary") ?? front.fields.get("description");
  const documentSummary: Summary | undefined =
    ownSummary !== undefined && ownSummary !== ""
      ? { summary: clip(ownSummary, BRAIN_SUMMARY_MAX), source: "front-matter" }
      : (summaryOfText(ownLines.filter((line) => !/^\s*\[!/.test(line))) ??
        (factsOf(front.fields) !== "" ? { summary: clip(factsOf(front.fields), BRAIN_SUMMARY_MAX), source: "facts" } : undefined));
  if (documentSummary !== undefined) Object.assign(document, toNode(documentSummary));
  // A document its own front matter retires says so first, so a reader does not take it for the current word.
  const status = front.fields.get("status")?.toLowerCase();
  if (status !== undefined && RETIRED_STATUSES.has(status) && documentSummary?.source !== "facts") {
    const replacedBy = front.fields.get("supersededBy") ?? front.fields.get("replacedBy");
    const note = `${status.charAt(0).toUpperCase()}${status.slice(1)}${replacedBy === undefined ? "" : ` by ${replacedBy}`}.`;
    document.summary = clip(document.summary === "" ? note : `${note} ${document.summary}`, BRAIN_SUMMARY_MAX);
  }
  return { nodes, links };
}

/** Front matter statuses of a document that no longer holds: its summary starts with them. */
const RETIRED_STATUSES = new Set(["superseded", "deprecated", "rejected", "retired", "withdrawn", "obsolete", "replaced"]);

function toNode(summary: Summary): Pick<BrainNode, "summary" | "summarySource"> {
  return { summary: summary.summary, summarySource: summary.source };
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

function readmeFirst(a: string, b: string): number {
  const nameA = a.split("/").pop()?.toLowerCase() ?? "";
  const nameB = b.split("/").pop()?.toLowerCase() ?? "";
  const rankA = README_FILES.indexOf(nameA);
  const rankB = README_FILES.indexOf(nameB);
  if (rankA !== rankB) return (rankA < 0 ? README_FILES.length : rankA) - (rankB < 0 ? README_FILES.length : rankB);
  return nameA.localeCompare(nameB, "en");
}

/**
 * The whole tree of a branch: a root, a folder per directory that holds an indexed document, then the
 * documents' own nodes, with links resolved to the nodes they point at. Folders come before documents, a
 * README (or index) first among the documents, both in name order. Documents beyond `BRAIN_MAX_DOCUMENTS` are
 * left out and counted in `skipped`.
 */
export function buildBrainTree(sources: readonly BrainSourceDocument[], rootTitle: string): BrainTree {
  const indexed = sources.filter((source) => isBrainIndexedPath(source.path)).sort((a, b) => a.path.localeCompare(b.path, "en"));
  const kept = indexed.slice(0, BRAIN_MAX_DOCUMENTS);
  const root: BrainNode = {
    id: BRAIN_ROOT_ID,
    parentId: null,
    kind: "root",
    path: "",
    anchor: null,
    title: clip(rootTitle, BRAIN_TITLE_MAX),
    summary: "",
    summarySource: "none",
    ordinal: 0,
    depth: 0,
    lineStart: null,
    lineEnd: null,
    subtreeEnd: null,
    tokens: 0,
    subtreeTokens: 0,
    children: 0,
    ids: [],
  };
  const folders = new Map<string, BrainNode>([[root.id, root]]);
  const folderOf = (path: string): BrainNode => {
    const id = brainFolderId(path);
    const known = folders.get(id);
    if (known !== undefined) return known;
    const slash = path.lastIndexOf("/");
    const parent = folderOf(slash < 0 ? "" : path.slice(0, slash));
    const folder: BrainNode = { ...root, id, parentId: parent.id, kind: "folder", path, title: path.slice(slash + 1), depth: parent.depth + 1 };
    folders.set(id, folder);
    return folder;
  };

  const documents: DocumentNodes[] = [];
  const folderChildren = new Map<string, Array<{ name: string; node: BrainNode; folder: boolean }>>();
  for (const source of kept) {
    const built = buildBrainDocument(source.path, source.text);
    const slash = source.path.lastIndexOf("/");
    const folder = folderOf(slash < 0 ? "" : source.path.slice(0, slash));
    const document = built.nodes[0];
    if (document === undefined) continue;
    document.parentId = folder.id;
    documents.push(built);
    folderChildren.set(folder.id, [...(folderChildren.get(folder.id) ?? []), { name: source.path, node: document, folder: false }]);
  }
  for (const folder of folders.values()) {
    if (folder.parentId === null) continue;
    folderChildren.set(folder.parentId, [...(folderChildren.get(folder.parentId) ?? []), { name: folder.path, node: folder, folder: true }]);
  }

  // Depths of everything under a folder follow the folder's own depth.
  const shift = (built: DocumentNodes, base: number): void => {
    for (const node of built.nodes) node.depth += base;
  };
  for (const built of documents) {
    const document = built.nodes[0];
    const parent = document?.parentId === null || document === undefined ? undefined : folders.get(document.parentId);
    if (parent !== undefined) shift(built, parent.depth + 1);
  }

  // Ordinals, child counts, token totals and summaries, deepest folders first.
  const ordered = [...folders.values()].sort((a, b) => b.depth - a.depth);
  const labels = new Map<string, string>();
  for (const folder of ordered) {
    const children = (folderChildren.get(folder.id) ?? []).sort((a, b) =>
      a.folder !== b.folder ? (a.folder ? -1 : 1) : a.folder ? a.name.localeCompare(b.name, "en") : readmeFirst(a.name, b.name),
    );
    children.forEach((child, ordinal) => {
      child.node.ordinal = ordinal;
    });
    folder.children = children.length;
    folder.subtreeTokens = children.reduce((total, child) => total + child.node.subtreeTokens, 0);
    const readme = children.find((child) => !child.folder && README_FILES.includes(child.name.split("/").pop()?.toLowerCase() ?? ""));
    const layout = folder.kind === "folder" ? describeDocumentFolder(folder.path) : undefined;
    const only = children.length === 1 && children[0]?.folder === false ? children[0].node : undefined;
    // Without a README, a folder says what it holds: its one document, or the names of its entries, so a reader
    // of the tree can tell look-alike folders (units named after programs) apart without opening each.
    const contents = children.map((child) => labels.get(child.node.id) ?? child.node.title).join(" · ");
    const summary: Summary =
      readme !== undefined && readme.node.summary !== "" && readme.node.summarySource !== "children"
        ? { summary: readme.node.summary, source: "readme" }
        : only !== undefined && only.summary !== ""
          ? { summary: clip(`${only.title}: ${only.summary}`, BRAIN_SUMMARY_MAX), source: "children" }
          : layout !== undefined
            ? { summary: clip(contents === "" ? layout : `${layout} Holds: ${contents}.`, BRAIN_SUMMARY_MAX), source: "layout" }
            : summaryOfChildren(children.map((child) => labels.get(child.node.id) ?? (child.folder ? `${child.node.title}/` : child.node.title)));
    Object.assign(folder, toNode(summary));
    // A folder that holds one document is known by that document's title, next to its own name.
    if (only !== undefined && only.title !== folder.title) labels.set(folder.id, `${folder.title} (${only.title})`);
  }

  const nodes: BrainNode[] = [...folders.values()].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id, "en"));
  for (const built of documents) nodes.push(...built.nodes);

  // Links: Markdown links to indexed nodes, and mentions of ids another node defines.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const definers = new Map<string, string[]>();
  for (const node of nodes) for (const id of node.ids) definers.set(id, [...(definers.get(id) ?? []), node.id]);
  const links: BrainLink[] = [];
  const seen = new Set<string>();
  const perNode = new Map<string, number>();
  const add = (fromId: string, toId: string, kind: BrainLink["kind"]): void => {
    if (fromId === toId) return;
    const key = `${fromId}\n${toId}`;
    const count = perNode.get(fromId) ?? 0;
    if (seen.has(key) || count >= BRAIN_MAX_LINKS_PER_NODE) return;
    seen.add(key);
    perNode.set(fromId, count + 1);
    links.push({ fromId, toId, kind });
  };
  for (const built of documents) {
    for (const link of built.links) {
      if (link.id !== undefined) {
        const targets = definers.get(link.id) ?? [];
        if (targets.length <= 3) for (const target of targets) add(link.fromId, target, "id");
        continue;
      }
      if (link.path === undefined) continue;
      const exact = link.anchor !== undefined ? byId.get(brainSectionId(link.path, link.anchor)) : undefined;
      const target = exact ?? byId.get(link.path) ?? byId.get(brainFolderId(link.path));
      if (target !== undefined) add(link.fromId, target.id, "link");
    }
  }

  root.children = (folderChildren.get(root.id) ?? []).length;
  return { nodes, links, documents: documents.length, identifiers: definers.size, skipped: indexed.length - kept.length };
}

// ---------------------------------------------------------------------------
// What the API serves (portal and member bridge alike)
// ---------------------------------------------------------------------------

export const BRAIN_STATES = ["off", "not-built", "queued", "indexing", "ready", "failed"] as const;
export type BrainState = (typeof BRAIN_STATES)[number];

/** A node's place in the tree, for breadcrumbs. */
export interface BrainCrumb {
  id: string;
  kind: BrainNodeKind;
  title: string;
}

export interface BrainStatusView {
  projectId: string;
  /** Whether the project has a mirrored document repository to index; `reason` says why not. */
  available: boolean;
  reason?: string;
  configured: boolean;
  enabled: boolean;
  state: BrainState;
  branch: string;
  defaultBranch: string | null;
  /** Branches that can be indexed (Kintsugi's own `kintsugi/*` output branches are left out). */
  branches: string[];
  commit: string | null;
  /** The branch's current tip; differs from `commit` while a newer commit waits for its build. */
  tip: string | null;
  indexedAt: string | null;
  documents: number;
  nodes: number;
  identifiers: number;
  links: number;
  tokens: number;
  skipped: number;
  durationMs: number | null;
  error: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Where a read came from, enough to cite it and to read it again. */
export interface BrainCitation {
  nodeId: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  commit: string;
}

export interface BrainTreeChild extends BrainNode {
  /** With `depth: 2`, the first children of this child. */
  nodes?: BrainNode[];
}

export interface BrainTreeView {
  projectId: string;
  branch: string;
  commit: string;
  node: BrainNode;
  breadcrumb: BrainCrumb[];
  children: BrainTreeChild[];
  total: number;
  offset: number;
}

export interface BrainLinkedNode extends BrainNode {
  linkKind: BrainLink["kind"];
}

export interface BrainReadView {
  projectId: string;
  branch: string;
  commit: string;
  node: BrainNode;
  breadcrumb: BrainCrumb[];
  /** `subtree`: the node with everything under it; `node`: its own text only (its children are listed instead). */
  scope: "subtree" | "node";
  text: string;
  /** Every line of `text` starts with its number and a tab (the member reads), so the lines used can be cited. */
  lineNumbers: boolean;
  /** The range that was read; cite the lines that hold the answer, within it. */
  citation: BrainCitation | null;
  /** The text was cut at the reader's budget; read on from `nextLine`. */
  truncated: boolean;
  nextLine: number | null;
  children: BrainNode[];
  outgoing: BrainLinkedNode[];
  incoming: BrainLinkedNode[];
  outgoingTotal: number;
  incomingTotal: number;
}

export interface BrainLookupView {
  projectId: string;
  branch: string;
  commit: string;
  query: string;
  matches: Array<BrainNode & { breadcrumb: BrainCrumb[] }>;
}

export interface BrainGrepMatch {
  node: BrainNode;
  breadcrumb: BrainCrumb[];
  line: number;
  excerpt: string;
}

export interface BrainGrepView {
  projectId: string;
  branch: string;
  commit: string;
  text: string;
  under: string | null;
  matches: BrainGrepMatch[];
  /** More lines matched than were returned. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// What the store keeps per project (knowledge.brain_source, migration 043)
// ---------------------------------------------------------------------------

export type BrainIndexState = "queued" | "indexing" | "ready" | "failed";

export interface BrainSource {
  projectId: string;
  branch: string;
  enabled: boolean;
  state: BrainIndexState;
  indexedCommit: string | null;
  attemptedCommit: string | null;
  indexedAt: string | null;
  builderVersion: number | null;
  documents: number;
  nodes: number;
  identifiers: number;
  links: number;
  tokens: number;
  skipped: number;
  durationMs: number | null;
  error: string | null;
  requestedAt: string;
  startedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface BrainNodePage {
  items: BrainNode[];
  total: number;
}

export interface BrainLinks {
  outgoing: BrainLinkedNode[];
  incoming: BrainLinkedNode[];
  outgoingTotal: number;
  incomingTotal: number;
}
