/**
 * The Brain (ADR-0091): a vectorless, reasoning-based index of one branch of the project's document repo.
 *
 * The index is a tree — folders, documents, their sections and their cards — with a short summary on every
 * node. An agent reads the summaries, decides where to descend and reads the nodes it picked; it cites what it
 * read by node id, path, lines and commit. Nothing is embedded, nothing is ranked by similarity and no model is
 * called to build the tree: titles and summaries come from the documents themselves (front matter, the first
 * paragraph, a table's columns, the layout). The text stays in Git; the tree holds line ranges into it.
 */
import { DOCUMENT_EXCLUDED_FOLDERS, DOCUMENT_EXCLUDED_ROOTS, describeDocumentFolder, isPageKey } from "./document-layout.js";
import { createHeadingSlugger, headingSlug, plainInlineText } from "./heading-slug.js";

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
  "section", // a document's Summary, Purpose or Decision section, or its first section in prose
  "none",
] as const;
export type BrainSummarySource = (typeof BRAIN_SUMMARY_SOURCES)[number];

/** The id of the tree's root. A folder's id is its path with a trailing `/`, a document's its path, a section's `path#anchor`. */
export const BRAIN_ROOT_ID = "/";
/** Bumped when the builder changes what it produces, so every index is rebuilt once. */
export const BRAIN_BUILDER_VERSION = 6;
export const BRAIN_SUMMARY_MAX = 240;
export const BRAIN_TITLE_MAX = 200;
/** Larger files are left out, as the document read API refuses them (docs/reference/document-repo-read-path.md). */
export const BRAIN_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const BRAIN_MAX_DOCUMENTS = 20_000;
/** Headings beyond this stay text of the node before them. */
export const BRAIN_MAX_NODES_PER_DOCUMENT = 2_000;
/**
 * Distinct links stored per node; ids mentioned by many documents would otherwise dominate the link table. A node with
 * more keeps its total (`BrainTree.linkTotals`), so a read can still say how many there are (P-036).
 */
export const BRAIN_MAX_LINKS_PER_NODE = 50;
/** Labels kept of a page's front matter (ADR-0096 decision 3). */
export const BRAIN_MAX_LABELS = 20;
/** Links to a page that is not in the index, kept per tree; a repository with more has bigger problems than the report. */
export const BRAIN_MAX_BROKEN_LINKS = 5_000;

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
  /** Page attributes from front matter (ADR-0097 decision 1). A folder takes those of its home page (`README.md`). */
  labels: string[];
  /** Lowercased front matter `status` (`archived` among others), or null. */
  status: string | null;
  owner: string | null;
  /** True for a page whose front matter says `type: template`; `template: <name>` names an origin and does not set it. */
  template: boolean;
  /** The key of the space (a home page's `key`) a folder or document is in, or null outside any space. */
  space: string | null;
  /**
   * The last commit that changed the document, up to the indexed commit; for a folder or the root, the latest of
   * what it holds. Null for a section or a card (history is kept per file), and when the history is not known.
   */
  changed: BrainChange | null;
}

/** A commit that changed a document: its id, its date and the first line of its message. */
export interface BrainChange {
  commit: string;
  at: string;
  subject: string;
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
  /** The distinct outgoing links of each node that has more than `BRAIN_MAX_LINKS_PER_NODE`, of which the first are stored. */
  linkTotals: Record<string, number>;
  /** Links to a Markdown page that is not in the index: the page that holds the link, and the path it points at. */
  broken: BrainBrokenLink[];
  /** Things a page's author should fix that did not stop the build, such as a space key ADR-0096 does not allow. */
  warnings: BrainWarning[];
}

/** A problem the builder found in a page and worked around: the page, and what is wrong. */
export interface BrainWarning {
  path: string;
  message: string;
}

export interface BrainBrokenLink {
  from: string;
  target: string;
}

export interface BrainSourceDocument {
  path: string;
  text: string;
  /** The last commit that changed the file, when the caller read the history. */
  changed?: BrainChange;
}

const README_FILES = ["readme.md", "index.md"];

/**
 * Whether a repository path belongs in the index: Markdown documents outside member plugins, run scratch,
 * restricted records, identifier ledgers and hidden folders.
 */
export function isBrainIndexedPath(path: string): boolean {
  if (!path.toLowerCase().endsWith(".md")) return false;
  const segments = path.split("/");
  // An empty segment, `.`, `..` and hidden names all fail here.
  if (segments.some((segment) => segment === "" || segment.startsWith("."))) return false;
  if (DOCUMENT_EXCLUDED_ROOTS.includes((segments[0] ?? "").toLowerCase())) return false;
  // The file's own name ends in `.md`, so only folders can match.
  return !segments.some((segment) => DOCUMENT_EXCLUDED_FOLDERS.includes(segment.toLowerCase()));
}

/** A document's lines as Git counts them: a newline ends a line, and a carriage return before it is dropped. */
export function brainLines(text: string): string[] {
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
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

/** An anchor is a heading slug or a reference id: never a dot or a `#`, so a `#` in a file name stays in the path. */
const ANCHOR = /^[\p{L}\p{N}_-]+$/u;

/** The document path and anchor of a node id; a folder id gives its path and no anchor. */
export function parseBrainNodeId(id: string): { path: string; anchor: string | null } {
  // The root `/` is the folder with the empty path.
  if (id.endsWith("/")) return { path: id.slice(0, -1), anchor: null };
  const hash = id.lastIndexOf("#");
  const path = id.slice(0, hash);
  const anchor = id.slice(hash + 1);
  return path.toLowerCase().endsWith(".md") && ANCHOR.test(anchor) ? { path, anchor } : { path: id, anchor: null };
}

/** A reference id: uppercase segments joined by `-`, ending in digits (`RULE-CARD01-0001`, `COM-LOG-01`, `API-001`). */
const ID_SOURCE = String.raw`[A-Z][A-Z0-9]{1,15}(?:-[A-Z0-9]{1,16})*-[0-9]{2,}[A-Z]?`;
const ID_PATTERN = new RegExp(`^${ID_SOURCE}$`);
const ID_MENTIONS = new RegExp(`(?<![A-Za-z0-9-])${ID_SOURCE}(?![A-Za-z0-9-])`, "g");
const CARD_HEADING = new RegExp(`^(${ID_SOURCE})(?:\\s*:\\s*(.*))?$`);
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
/** A Markdown link; its target is written bare or in angle brackets, which allow spaces (`[x](<my notes.md>)`). */
// Neither part runs past the start of another link (`[` in the text and a bare target, `<` in an angle target), so each
// line is read in linear time.
const LINK = /(?<!!)\[([^[\]\n]{0,1000})\]\((?:<([^<>\n]{1,2048})>|([^)\s[]{1,2048}))(?:[ \t]+"[^"\n]{0,300}")?\)/g;
/** The characters of a line the link pattern reads, as the reader's line cap. */
const LINK_LINE = 4_000;

export function isBrainReferenceId(value: string): boolean {
  return ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const blank = (char: string | undefined): boolean => char === " " || char === "\t";

/**
 * The level and text of an ATX heading line (`## Title ##`), or undefined. Linear: the regex it replaces,
 * `^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$`, backtracked cubically on a long run of spaces, so one line of a document
 * stopped the worker for minutes (T3-011). The results are the same, a closing run of `#` included.
 */
export function atxHeading(line: string): { level: number; text: string } | undefined {
  let level = 0;
  while (line[level] === "#") level += 1;
  // `.` and `[ \t]` match no line terminator, so a line holding one after the marker was no heading.
  if (level < 1 || level > 6 || !blank(line[level]) || /[\n\r\u2028\u2029]/.test(line.slice(level))) return undefined;
  let start = level;
  while (blank(line[start])) start += 1;
  let end = line.length;
  while (end > start && blank(line[end - 1])) end -= 1;
  // Only blanks after the marker: the regex took the last as the text when there were two or more.
  if (end === start) return line.length - level >= 2 ? { level, text: line.slice(-1) } : undefined;
  let close = end;
  while (close > start && line[close - 1] === "#") close -= 1;
  while (close > start && blank(line[close - 1])) close -= 1;
  // Only `#` after the marker (`# #`): the regex kept the first.
  return { level, text: close === start ? line.slice(start, start + 1) : line.slice(start, close) };
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}

/**
 * The anchor of a heading, kept for callers that still import it; the one implementation is `headingSlug`
 * (`heading-slug.ts`).
 */
export const brainAnchor = headingSlug;

interface FrontMatter {
  fields: Map<string, string>;
  /** Lists: the flow form `key: [a, b]` and the block form (`key:` then `  - "item"`); `fields` keeps the flow text. */
  lists: Map<string, string[]>;
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
  // A single-quoted YAML scalar writes a quote inside it twice.
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

/** Scalar facts between two `---` lines at the top (docs/reference/document-formats.md); block lists are skipped. */
function frontMatterOf(lines: readonly string[]): FrontMatter {
  const fields = new Map<string, string>();
  const lists = new Map<string, string[]>();
  if (lines[0]?.trim() !== "---") return { fields, lists, lines: 0 };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0 || end > 400) return { fields, lists, lines: 0 };
  let block: string[] | undefined;
  for (const line of lines.slice(1, end)) {
    const item = /^[ \t]*-[ \t]+(.*)$/.exec(line);
    if (block !== undefined && item?.[1] !== undefined) {
      block.push(scalar(item[1]));
      continue;
    }
    block = undefined;
    const pair = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    // An empty value (`title: ""` too) says nothing: the next source of the title or summary applies.
    const value = pair?.[2] === undefined ? "" : scalar(pair[2]);
    if (pair?.[1] === undefined) continue;
    if (value !== "") fields.set(pair[1], value);
    const raw = (pair[2] ?? "").trim();
    if (raw === "") {
      block = [];
      lists.set(pair[1], block);
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      lists.set(pair[1], raw.slice(1, -1).split(",").map((entry) => scalar(entry)).filter((entry) => entry !== ""));
    }
  }
  return { fields, lists, lines: end + 1 };
}

/** A page's labels: lowercased, only `a-z`, `0-9` and `-` kept, no empty or repeated one, at most `BRAIN_MAX_LABELS`. */
export function brainLabels(values: readonly string[]): string[] {
  const labels = new Set<string>();
  for (const value of values) {
    const label = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (label !== "") labels.add(label);
  }
  return [...labels].slice(0, BRAIN_MAX_LABELS);
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

/**
 * Whether a line closes the code fence `fence` opened (CommonMark): a run of the same character at least as long,
 * with nothing after it. A shorter run inside, as in a fence that shows a fenced example, is text.
 */
function closesFence(line: string, fence: string): boolean {
  const run = /^(`+|~+)\s*$/.exec(line.trim())?.[1];
  return run !== undefined && run[0] === fence[0] && run.length >= fence.length;
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
      if (closesFence(line, fence)) {
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
      fence = open[1];
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
    .map((cell) => plainInlineText(cell));
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
      .map((match) => `${plainInlineText(match[1] ?? "")}: ${plainInlineText(match[2] ?? "")}`);
    return { summary: clip(fields.join(" · "), BRAIN_SUMMARY_MAX), source: "fields" };
  }
  if (LIST_ITEM.test(block[0] ?? "")) {
    const items = block
      .map((line) => LIST_ITEM.exec(line)?.[1])
      .filter((item): item is string => item !== undefined)
      .map(plainInlineText);
    return { summary: clip(items.join("; "), BRAIN_SUMMARY_MAX), source: "list" };
  }
  if (/^(>|\s*<)/.test(first) && plainInlineText(block.join(" ").replace(/^>\s?/gm, "")) === "") return undefined;
  const text = plainInlineText(block.map((line) => line.replace(/^>\s?/, "")).join(" "));
  return text === "" ? undefined : { summary: clip(text, BRAIN_SUMMARY_MAX), source: "paragraph" };
}

/** The summary of a node's own text (its heading line excluded), or undefined when it has none. */
/** Prose says best what a node is about: a paragraph among the first blocks wins over a list, a table or a diagram before it. */
const PROSE_LOOKAHEAD = 4;

function summaryOfText(lines: readonly string[]): Summary | undefined {
  const blocks = blocksOf(lines);
  const found = blocks.map(summaryOfBlock);
  const proseAt = found.slice(0, PROSE_LOOKAHEAD).findIndex((summary) => summary?.source === "paragraph");
  const prose = proseAt < 0 ? undefined : found[proseAt];
  if (prose !== undefined) {
    if (blocks.length === 1 && plainInlineText(lines.join(" ")).length <= BRAIN_SUMMARY_MAX) return { summary: prose.summary, source: "text" };
    // A sentence that ends on a colon introduces the list after it: the list is what it says.
    const next = found[proseAt + 1];
    if (prose.summary.endsWith(":") && next !== undefined && (next.source === "list" || next.source === "fields")) {
      return { summary: clip(`${prose.summary} ${next.summary}`, BRAIN_SUMMARY_MAX), source: "paragraph" };
    }
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

/** A reference a document makes, before it is resolved against the other documents: a Markdown link or a mention of an id. */
export type BrainPendingLink = PendingLink;

interface Heading {
  line: number; // 0-based
  level: number;
  text: string;
}

/** The headings of a document, outside code fences and HTML comments (a commented-out section is not one). */
function headingsOf(lines: readonly string[], from: number): Heading[] {
  const headings: Heading[] = [];
  let fence: string | undefined;
  let comment = false;
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const open = FENCE.exec(line);
    if (fence !== undefined) {
      if (closesFence(line, fence)) fence = undefined;
      continue;
    }
    if (comment) {
      if (line.includes("-->")) comment = false;
      continue;
    }
    if (line.trim().startsWith("<!--")) {
      comment = !line.includes("-->");
      continue;
    }
    if (open?.[1] !== undefined) {
      fence = open[1];
      continue;
    }
    const heading = atxHeading(line);
    if (heading !== undefined && headings.length < BRAIN_MAX_NODES_PER_DOCUMENT) headings.push({ line: index, ...heading });
  }
  return headings;
}

function resolveTarget(fromPath: string, target: string): { path: string; anchor?: string } | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) return undefined;
  const hash = target.indexOf("#");
  const rawPath = hash < 0 ? target : target.slice(0, hash);
  let decoded: string;
  let anchor: string | undefined;
  try {
    decoded = decodeURIComponent(rawPath.split("?")[0] ?? "");
    anchor = hash < 0 ? undefined : decodeURIComponent(target.slice(hash + 1));
  } catch {
    // A malformed escape (`#50%`) points nowhere; it must not stop the build.
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
  // Line by line, at most LINK_LINE characters of each, with a bounded pattern: over a whole document a run of `[` or
  // of `[a](` made the link pattern quadratic and held the worker (T3-016).
  for (const line of lines) {
    for (const match of line.slice(0, LINK_LINE).matchAll(LINK)) {
      const target = resolveTarget(fromPath, match[2] ?? match[3] ?? "");
      if (target !== undefined) found.push({ fromId, ...target });
    }
  }
  const text = lines.join("\n");
  for (const match of text.matchAll(ID_MENTIONS)) found.push({ fromId, id: match[0] });
  return found;
}

interface DocumentNodes {
  nodes: BrainNode[];
  links: PendingLink[];
  /** Front matter `key` (or `space`) of a home page, upper-cased: the space it makes. Null when absent or not a valid key. */
  key: string | null;
  /** The `key` as written when it is not a valid space key even upper-cased (ADR-0096), so the tree can warn about it. */
  invalidKey: string | null;
  /** Front matter `order`: the names of a folder's entries that come first. */
  order: string[];
  /** For each card, the GitHub-style slug of its heading text, which a link may name instead of the card's id. */
  cardAliases: Array<[string, string]>;
}

/**
 * The nodes of one document: the document, then one node per heading (a card when the heading starts with a
 * reference id), in order. A single top-level `#` heading is the document's title, not a node of its own.
 * Depths, ordinals and parents below the document are set; the document's own are set by the tree.
 */
export function buildBrainDocument(path: string, text: string): DocumentNodes {
  const lines = brainLines(text);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const front = frontMatterOf(lines);
  const headings = headingsOf(lines, front.lines);
  const topLevel = headings.filter((heading) => heading.level === 1);
  const titleHeading = topLevel.length === 1 && topLevel[0] === headings[0] ? topLevel[0] : undefined;
  const sections = titleHeading === undefined ? headings : headings.slice(1);
  const fileName = path.split("/").pop() ?? path;
  const title = clip(
    front.fields.get("title") ?? (titleHeading !== undefined ? plainInlineText(titleHeading.text) : (front.fields.get("name") ?? fileName.replace(/\.md$/i, ""))),
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
    labels: brainLabels(front.lists.get("labels") ?? []),
    status: front.fields.get("status")?.toLowerCase() ?? null,
    owner: front.fields.get("owner") ?? null,
    template: front.fields.get("type")?.toLowerCase() === "template",
    space: null,
    changed: null,
  };
  const nodes: BrainNode[] = [document];
  const cardAliases: Array<[string, string]> = [];
  const links: PendingLink[] = linksOf(path, path, ownLines);

  const slugger = createHeadingSlugger();
  const stack: Array<{ level: number; node: BrainNode }> = [];
  const childCount = new Map<string, number>();
  const childTitles = new Map<string, string[]>();
  for (const [index, heading] of sections.entries()) {
    const headingText = plainInlineText(heading.text);
    const card = CARD_HEADING.exec(headingText.replace(/`/g, ""));
    const id = card?.[1];
    const anchor = id !== undefined ? slugger.reserve(id) : slugger.slug(heading.text);
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
      labels: [],
      status: null,
      owner: null,
      template: false,
      space: null,
      changed: null,
    };
    if (id !== undefined) cardAliases.push([nodeId, headingSlug(heading.text)]);
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
  const ownText = summaryOfText(ownLines.filter((line) => !/^\s*\[!/.test(line)));
  const documentSummary: Summary | undefined =
    ownSummary !== undefined && ownSummary !== ""
      ? { summary: clip(ownSummary, BRAIN_SUMMARY_MAX), source: "front-matter" }
      : ((ownText !== undefined && isProse(ownText) ? ownText : undefined) ??
        sectionSummary(nodes.filter((node) => node.parentId === path), true) ??
        ownText ??
        sectionSummary(nodes.filter((node) => node.parentId === path), false) ??
        (factsOf(front.fields) !== "" ? { summary: clip(factsOf(front.fields), BRAIN_SUMMARY_MAX), source: "facts" } : undefined));
  if (documentSummary !== undefined) Object.assign(document, toNode(documentSummary));
  // A document its own front matter retires says so first, so a reader does not take it for the current word.
  const status = front.fields.get("status")?.toLowerCase();
  if (status !== undefined && RETIRED_STATUSES.has(status) && documentSummary?.source !== "facts") {
    const replacedBy = front.fields.get("supersededBy") ?? front.fields.get("replacedBy");
    const note = `${status.charAt(0).toUpperCase()}${status.slice(1)}${replacedBy === undefined ? "" : ` by ${replacedBy}`}.`;
    document.summary = clip(document.summary === "" ? note : `${note} ${document.summary}`, BRAIN_SUMMARY_MAX);
  }
  if (document.template) document.summary = clip(document.summary === "" ? "Template." : `Template. ${document.summary}`, BRAIN_SUMMARY_MAX);
  const order = front.lists.get("order") ?? [];
  // A space key is read in any case and kept in upper case, the case a lookup compares in (P-019).
  const writtenKey = front.fields.get("key") ?? front.fields.get("space");
  const upperKey = writtenKey?.toUpperCase();
  const valid = upperKey !== undefined && isPageKey(upperKey);
  return { nodes, links, key: valid ? upperKey : null, invalidKey: writtenKey !== undefined && !valid ? writtenKey : null, order, cardAliases };
}

/**
 * Sections that say what their document is, best first. A document that opens on its sections (a rule file, a
 * decision record) is summed up by the first of these that is written in prose.
 */
const SUMMARY_SECTIONS = ["summary", "purpose", "overview", "description", "abstract", "decision", "intent", "goal", "objective", "scope", "context"];

function isProse(summary: Summary): boolean {
  return summary.source === "paragraph" || summary.source === "text";
}

/**
 * The summary of a document taken from its top sections: the best-named section in prose, or (`named` false) the
 * first section in prose.
 */
function sectionSummary(sections: readonly BrainNode[], named: boolean): Summary | undefined {
  const prose = sections.filter((section) => isProse({ summary: section.summary, source: section.summarySource }));
  const chosen = named
    ? SUMMARY_SECTIONS.map((name) => prose.find((section) => section.title.trim().toLowerCase().replace(/[:.]$/, "") === name)).find((section) => section !== undefined)
    : prose[0];
  return chosen === undefined ? undefined : { summary: chosen.summary, source: "section" };
}

/** Front matter statuses of a document that no longer holds: its summary starts with them. */
const RETIRED_STATUSES = new Set(["superseded", "deprecated", "rejected", "retired", "withdrawn", "obsolete", "replaced", "archived"]);

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
/**
 * What the tree needs of one document, and nothing that depends on the other documents: its nodes (the document first,
 * depths counted from the document), the references it makes, the front matter its folder reads, and the commit that
 * last changed it. A part comes from the document's text (`brainDocumentPart`) or from the rows a build stored
 * (`brainPartsFromRows`); `assembleBrainTree` turns a set of parts into the tree, the same way whichever they came from
 * (ADR-0097 decision 6).
 */
export interface BrainDocumentPart {
  path: string;
  nodes: BrainNode[];
  refs: BrainPendingLink[];
  /** Front matter `key` (or `space`) of a home page, upper-cased; null when absent or not a valid key. */
  key: string | null;
  /** The key as written when it is not valid even upper-cased, so the tree can warn about it. */
  invalidKey: string | null;
  /** Front matter `order` of a home page. */
  order: string[];
  /** For each card, the GitHub-style slug of its heading text. */
  cardAliases: Array<[string, string]>;
  changed: BrainChange | null;
}

/** The part of one document: built from its text alone, so it never depends on another document. */
export function brainDocumentPart(source: BrainSourceDocument): BrainDocumentPart {
  const built = buildBrainDocument(source.path, source.text);
  return {
    path: source.path,
    nodes: built.nodes,
    refs: built.links,
    key: built.key,
    invalidKey: built.invalidKey,
    order: built.order,
    cardAliases: built.cardAliases,
    changed: source.changed ?? null,
  };
}

/** A reference of a document as a stored row; the order of a document's rows is the order its references were found in. */
export interface BrainRefRow {
  path: string;
  ordinal: number;
  fromId: string;
  kind: "link" | "id";
  targetPath: string | null;
  targetAnchor: string | null;
  targetId: string | null;
}

/** What a node keeps of its document's front matter that the tree reads again: a home page's key and order, a card's anchor alias. */
export interface BrainHome {
  key?: string;
  invalidKey?: string;
  order?: string[];
  alias?: string;
}

/** The rows of a document's references, as a build stores them. */
export function brainRefRows(part: BrainDocumentPart): BrainRefRow[] {
  return part.refs.map((ref, ordinal) => ({
    path: part.path,
    ordinal,
    fromId: ref.fromId,
    kind: ref.id !== undefined ? "id" : "link",
    targetPath: ref.path ?? null,
    targetAnchor: ref.anchor ?? null,
    targetId: ref.id ?? null,
  }));
}

/** What a build stores next to a node of the part so the part can be built again from rows; null when there is nothing. */
export function brainHomeOf(part: BrainDocumentPart, node: BrainNode): BrainHome | null {
  if (node.kind === "card") {
    const alias = part.cardAliases.find(([id]) => id === node.id)?.[1];
    return alias === undefined ? null : { alias };
  }
  if (node.kind !== "document") return null;
  const home: BrainHome = {};
  if (part.key !== null) home.key = part.key;
  if (part.invalidKey !== null) home.invalidKey = part.invalidKey;
  if (part.order.length > 0) home.order = part.order;
  return Object.keys(home).length === 0 ? null : home;
}

/**
 * The parts of the documents a build stored, from their node rows (as stored: depths from the root, ordinals and
 * spaces as the tree set them) and reference rows. Folder and root rows are ignored: `assembleBrainTree` makes them
 * again. The result is what `brainDocumentPart` gave when the rows were written, so assembling it with the parts of the
 * documents that changed gives the tree of a whole build.
 */
export function brainPartsFromRows(rows: ReadonlyArray<{ node: BrainNode; home: BrainHome | null }>, refs: readonly BrainRefRow[]): BrainDocumentPart[] {
  const byPath = new Map<string, Array<{ node: BrainNode; home: BrainHome | null }>>();
  for (const row of rows) {
    if (row.node.kind !== "document" && row.node.kind !== "section" && row.node.kind !== "card") continue;
    byPath.set(row.node.path, [...(byPath.get(row.node.path) ?? []), row]);
  }
  const refsByPath = new Map<string, BrainRefRow[]>();
  for (const ref of refs) refsByPath.set(ref.path, [...(refsByPath.get(ref.path) ?? []), ref]);
  const parts: BrainDocumentPart[] = [];
  for (const [path, group] of byPath) {
    // The document's heading lines come in the order its headings did: the document first, then by line.
    const ordered = [...group].sort((a, b) => (a.node.kind === "document" ? -1 : b.node.kind === "document" ? 1 : (a.node.lineStart ?? 0) - (b.node.lineStart ?? 0)));
    const document = ordered[0];
    if (document === undefined || document.node.kind !== "document") continue;
    const base = document.node.depth;
    const nodes = ordered.map(({ node }) => ({ ...node, ids: [...node.ids], labels: [...node.labels], depth: node.depth - base }));
    const head = nodes[0];
    if (head === undefined) continue;
    Object.assign(head, { parentId: null, ordinal: 0, space: null, changed: null });
    const home = document.home;
    parts.push({
      path,
      nodes,
      refs: (refsByPath.get(path) ?? [])
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((ref) => (ref.kind === "id" ? { fromId: ref.fromId, id: ref.targetId ?? "" } : { fromId: ref.fromId, path: ref.targetPath ?? "", ...(ref.targetAnchor === null ? {} : { anchor: ref.targetAnchor }) })),
      key: home?.key ?? null,
      invalidKey: home?.invalidKey ?? null,
      order: home?.order ?? [],
      cardAliases: ordered.flatMap(({ node, home: nodeHome }) => (nodeHome?.alias === undefined ? [] : [[node.id, nodeHome.alias] as [string, string]])),
      changed: document.node.changed,
    });
  }
  return parts;
}

/**
 * A folder's entries with the ones its home page lists in `order` first, in list order, the rest as they were. A name
 * matches a folder of that name, else a document `<name>` or `<name>.md`; a folder wins when both match, a name that
 * matches nothing is ignored and an entry is placed once (ADR-0097 decision 2).
 */
function withManualOrder<T extends { name: string; folder: boolean }>(entries: readonly T[], order: readonly string[]): T[] {
  if (order.length === 0) return [...entries];
  const base = (entry: T): string => entry.name.split("/").pop() ?? entry.name;
  const placed = new Set<T>();
  for (const wanted of order) {
    const name = wanted.replace(/\/+$/, "");
    const entry = entries.find((candidate) => candidate.folder && base(candidate) === name) ?? entries.find((candidate) => !candidate.folder && (base(candidate) === name || base(candidate) === `${name}.md`));
    if (entry !== undefined) placed.add(entry);
  }
  return [...placed, ...entries.filter((entry) => !placed.has(entry))];
}

export function buildBrainTree(sources: readonly BrainSourceDocument[], rootTitle: string): BrainTree {
  const indexed = sources.filter((source) => isBrainIndexedPath(source.path)).sort((a, b) => a.path.localeCompare(b.path, "en"));
  const kept = indexed.slice(0, BRAIN_MAX_DOCUMENTS);
  return assembleBrainTree(kept.map(brainDocumentPart), rootTitle, indexed.length);
}

/** A copy of a part the assembly may change: it sets parents, depths, ordinals, spaces and the commit of the nodes it holds. */
function clonePart(part: BrainDocumentPart): BrainDocumentPart {
  return { ...part, nodes: part.nodes.map((node) => ({ ...node })) };
}

/**
 * The tree of a set of document parts: folders, order, summaries, spaces, links and broken links, everything that
 * depends on more than one document. The parts are not changed and may come in any order. `indexed` is how many
 * documents the repository holds that the Brain indexes, which is more than `parts` when the cap cut some off.
 */
export function assembleBrainTree(parts: readonly BrainDocumentPart[], rootTitle: string, indexed: number = parts.length): BrainTree {
  const kept = [...parts].sort((a, b) => a.path.localeCompare(b.path, "en")).map(clonePart);
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
    labels: [],
    status: null,
    owner: null,
    template: false,
    space: null,
    changed: null,
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

  const documents: BrainDocumentPart[] = [];
  const orderOf = new Map<string, string[]>();
  const keyOf = new Map<string, string>();
  const warnings: BrainWarning[] = [];
  const folderChildren = new Map<string, Array<{ name: string; node: BrainNode; folder: boolean }>>();
  for (const built of kept) {
    const slash = built.path.lastIndexOf("/");
    const folder = folderOf(slash < 0 ? "" : built.path.slice(0, slash));
    const document = built.nodes[0];
    if (document === undefined) continue;
    document.parentId = folder.id;
    document.changed = built.changed;
    documents.push(built);
    if (built.order.length > 0) orderOf.set(built.path, built.order);
    if (built.key !== null) keyOf.set(built.path, built.key);
    // Only a home page makes a space, so only its key is worth a warning.
    if (built.invalidKey !== null && README_FILES.includes(built.path.split("/").pop()?.toLowerCase() ?? "")) {
      warnings.push({ path: built.path, message: `The space key "${clip(built.invalidKey, 40)}" is not a space key: use 2 to 10 letters or digits, starting with a letter.` });
    }
    folderChildren.set(folder.id, [...(folderChildren.get(folder.id) ?? []), { name: built.path, node: document, folder: false }]);
  }
  for (const folder of folders.values()) {
    if (folder.parentId === null) continue;
    folderChildren.set(folder.parentId, [...(folderChildren.get(folder.parentId) ?? []), { name: folder.path, node: folder, folder: true }]);
  }

  // Depths of everything under a folder follow the folder's own depth.
  const shift = (built: BrainDocumentPart, base: number): void => {
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
    const sorted = (folderChildren.get(folder.id) ?? []).sort((a, b) =>
      a.folder !== b.folder ? (a.folder ? -1 : 1) : a.folder ? a.name.localeCompare(b.name, "en") : readmeFirst(a.name, b.name),
    );
    const home = sorted.find((child) => !child.folder && README_FILES.includes(child.name.split("/").pop()?.toLowerCase() ?? ""));
    const children = withManualOrder(sorted, home === undefined ? [] : (orderOf.get(home.name) ?? []));
    children.forEach((child, ordinal) => {
      child.node.ordinal = ordinal;
    });
    folder.children = children.length;
    folder.subtreeTokens = children.reduce((total, child) => total + child.node.subtreeTokens, 0);
    folder.changed = children.reduce<BrainChange | null>(
      (latest, child) => (child.node.changed !== null && (latest === null || child.node.changed.at > latest.at) ? child.node.changed : latest),
      null,
    );
    const readme = home;
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
    // A folder that is a page takes the attributes of its home page (ADR-0096 decision 3).
    if (readme !== undefined) Object.assign(folder, { labels: readme.node.labels, status: readme.node.status, owner: readme.node.owner });
    // A folder that holds one document is known by that document's title, next to its own name.
    if (only !== undefined && only.title !== folder.title) labels.set(folder.id, `${folder.title} (${only.title})`);
  }

  // Spaces: a home page's key makes its folder and everything below it a space, until another home page says otherwise.
  const spaceOf = new Map<string, string | null>();
  for (const folder of [...folders.values()].sort((a, b) => a.depth - b.depth)) {
    const home = (folderChildren.get(folder.id) ?? []).find((child) => !child.folder && README_FILES.includes(child.name.split("/").pop()?.toLowerCase() ?? ""));
    const space = (home === undefined ? undefined : keyOf.get(home.name)) ?? (folder.parentId === null ? null : (spaceOf.get(folder.parentId) ?? null));
    spaceOf.set(folder.id, space);
    folder.space = space;
  }
  for (const built of documents) {
    const document = built.nodes[0];
    if (document?.parentId !== null && document !== undefined) document.space = spaceOf.get(document.parentId ?? "") ?? null;
  }

  const nodes: BrainNode[] = [...folders.values()].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id, "en"));
  for (const built of documents) nodes.push(...built.nodes);

  // Links: Markdown links to indexed nodes, and mentions of ids another node defines.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // A link may name a section in another case, and a card by the GitHub anchor of its heading
  // (`#rule-inv01-0001-late-fee`) rather than by its id.
  const headingAnchors = new Map<string, BrainNode>();
  for (const built of documents) {
    for (const [cardId, alias] of built.cardAliases) {
      const card = byId.get(cardId);
      const key = card === undefined ? undefined : brainSectionId(card.path, alias);
      if (card !== undefined && key !== undefined && !headingAnchors.has(key)) headingAnchors.set(key, card);
    }
  }
  const anchored = (path: string, anchor: string): BrainNode | undefined =>
    byId.get(brainSectionId(path, anchor)) ?? byId.get(brainSectionId(path, anchor.toLowerCase())) ?? headingAnchors.get(brainSectionId(path, anchor.toLowerCase()));
  const definers = new Map<string, string[]>();
  for (const node of nodes) for (const id of node.ids) definers.set(id, [...(definers.get(id) ?? []), node.id]);
  const links: BrainLink[] = [];
  const broken: BrainBrokenLink[] = [];
  const brokenSeen = new Set<string>();
  const seen = new Set<string>();
  const perNode = new Map<string, number>();
  const add = (fromId: string, toId: string, kind: BrainLink["kind"]): void => {
    if (fromId === toId) return;
    const key = `${fromId}\n${toId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const count = (perNode.get(fromId) ?? 0) + 1;
    perNode.set(fromId, count);
    if (count <= BRAIN_MAX_LINKS_PER_NODE) links.push({ fromId, toId, kind });
  };
  for (const built of documents) {
    for (const link of built.refs) {
      if (link.id !== undefined) {
        const targets = definers.get(link.id) ?? [];
        if (targets.length <= 3) for (const target of targets) add(link.fromId, target, "id");
        continue;
      }
      if (link.path === undefined) continue;
      const exact = link.anchor !== undefined ? anchored(link.path, link.anchor) : undefined;
      const target = exact ?? byId.get(link.path) ?? byId.get(brainFolderId(link.path));
      if (target !== undefined) add(link.fromId, target.id, "link");
      else if (/\.md$/i.test(link.path) && broken.length < BRAIN_MAX_BROKEN_LINKS) {
        const from = parseBrainNodeId(link.fromId).path;
        if (!brokenSeen.has(`${from}\n${link.path}`)) {
          brokenSeen.add(`${from}\n${link.path}`);
          broken.push({ from, target: link.path });
        }
      }
    }
  }

  root.children = (folderChildren.get(root.id) ?? []).length;
  const linkTotals = Object.fromEntries([...perNode].filter(([, count]) => count > BRAIN_MAX_LINKS_PER_NODE));
  return { nodes, links, documents: documents.length, identifiers: definers.size, skipped: indexed - kept.length, linkTotals, broken, warnings };
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
  /** The wiki is on for the project: its Brain follows the default branch and cannot be turned off or moved. */
  wiki: boolean;
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

/** One link to a page: the node that holds the link, the node of the page it points at, and what kind of link it is. */
export interface BrainBacklink {
  /** The deepest node (section or card) of another document whose text holds the link. */
  node: BrainNode;
  /** What it points at: the page itself, or one of its headings or cards. */
  target: BrainNode;
  linkKind: BrainLink["kind"];
}

/** The pages that link to a node, a window of them in path order (ADR-0097 decision 8). */
export interface BrainBacklinksView {
  projectId: string;
  branch: string;
  commit: string;
  node: BrainNode;
  items: BrainBacklink[];
  total: number;
  offset: number;
  /** The offset of the next window, or null after the last. */
  nextOffset: number | null;
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
  /** The space key (upper case) and the label the search was limited to, when it was. */
  space: string | null;
  label: string | null;
  matches: BrainGrepMatch[];
  /** More lines matched than were returned. */
  truncated: boolean;
}

export const BRAIN_CHANGE_STATUSES = ["added", "modified", "deleted", "renamed"] as const;
export type BrainChangeStatus = (typeof BRAIN_CHANGE_STATUSES)[number];

/** One indexed document that changed between two commits. */
export interface BrainChangedFile {
  path: string;
  status: BrainChangeStatus;
  /** The path before a rename. */
  previousPath: string | null;
  added: number;
  removed: number;
  /**
   * The sections and cards of the current document whose lines changed, deepest first in document order; the
   * document itself when its lines could not be told apart; none for a deleted document.
   */
  nodes: BrainNode[];
}

/** The links of the indexed documents that point at a Markdown file the repository does not have, at the indexed commit. */
export interface BrainBrokenView {
  projectId: string;
  branch: string;
  commit: string;
  /** Source document and the target path as written, in the order the build found them. */
  links: BrainBrokenLink[];
  /** The build keeps at most `BRAIN_MAX_BROKEN_LINKS`: there may be more. */
  truncated: boolean;
}

/** What changed in the indexed documents between an earlier commit and the indexed one. */
export interface BrainChangesView {
  projectId: string;
  branch: string;
  commit: string;
  /** The earlier commit, in full. */
  since: string;
  files: BrainChangedFile[];
  /** False when the earlier commit's text is not in the mirror: documents are listed without their sections. */
  linesKnown: boolean;
  /** More documents changed than were returned. */
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
  /** The project's wiki is on (ADR-0097 decision 5): the Brain follows the default branch and stays on. */
  wiki: boolean;
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

/** Raw rows of the links to a node, before the nodes behind them are read. */
export interface BrainBacklinkRows {
  rows: Array<{ fromId: string; toId: string; kind: BrainLink["kind"] }>;
  total: number;
}

export interface BrainLinks {
  outgoing: BrainLinkedNode[];
  incoming: BrainLinkedNode[];
  outgoingTotal: number;
  incomingTotal: number;
}
