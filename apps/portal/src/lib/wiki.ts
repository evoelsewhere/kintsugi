// What the wiki reader says about the document repository: the address of a page, which Brain nodes make the page tree
// and in what order, and whether a project's wiki is on. Kept apart from the views so it can be tested.
// The reader is read-only (ADR-0096, ADR-0097): everything comes from the Brain's tree and the documents routes.

import type { BrainGrepMatch, BrainNode } from "@kintsugi/domain";
import { BRAIN_ROOT_ID, brainLabels } from "@kintsugi/domain";
import { resolveDocumentLink } from "./document-links";

/** The wiki lives under `/wiki/<path of the page in the document repo>`; the project is the `?project=` of the URL. */
export const WIKI_BASE = "/wiki";

/** A project as the wiki reads it: the wiki switch is `wiki` on the project view (CO-P2-008); an API without it says nothing. */
export interface WikiProjectFlag {
  wiki?: boolean | undefined;
}

/** The wiki is off only when the API says so: a project view that carries no flag is read as on. */
export const wikiIsOff = (project: WikiProjectFlag | undefined): boolean => project?.wiki === false;

const decode = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** The repository path an address holds (the router's splat): no leading or trailing slash, no empty or `.` segments. */
export function pathOfSplat(splat: string | undefined): string {
  return (splat ?? "")
    .split("/")
    .map(decode)
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}

/** A page is a Markdown file; any other path of the wiki is a folder. */
export const isPagePath = (path: string): boolean => /\.md$/i.test(path);

/** The address of a page or folder of a project, with the heading it scrolls to when there is one. */
export function wikiLink(projectId: string, path: string, anchor?: string): string {
  const route = path === "" ? WIKI_BASE : `${WIKI_BASE}/${path.split("/").map(encodeURIComponent).join("/")}`;
  return `${route}?project=${encodeURIComponent(projectId)}${anchor === undefined || anchor === "" ? "" : `#${encodeURIComponent(anchor)}`}`;
}

/** The folder a path is in; "" for the root. */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** A file or folder name the way the tree shows it when it has no title: the name without `.md`. */
export function nameOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return isPagePath(name) ? name.slice(0, -3) : name;
}

/** The trail from the root to a path: each folder and the page itself with the path that opens it. */
export function pathTrail(path: string): Array<{ label: string; path: string }> {
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments.map((label, index) => ({ label, path: segments.slice(0, index + 1).join("/") }));
}

const HOME_PAGES = ["readme.md", "index.md"];

/** The home page of a folder: its `README.md` or `index.md` (the Brain reads a folder's attributes from it). */
export const isHomePage = (node: Pick<BrainNode, "kind" | "path">): boolean => node.kind === "document" && HOME_PAGES.includes(node.path.split("/").pop()?.toLowerCase() ?? "");

/** Archived pages and templates are not part of what people read (ADR-0097 decision 1); the Brain keeps them for the owners. */
export const isHiddenPage = (node: Pick<BrainNode, "status" | "template">): boolean => node.template || node.status === "archived";

/**
 * What a folder shows in the page tree: its folders and pages in the Brain's order (the manual `order` of its home
 * page first, then folders, then pages by name), without sections and cards, archived pages and templates.
 * A folder takes the attributes of its home page, so an archived home page hides the whole folder.
 */
export function pageEntries<T extends BrainNode>(children: readonly T[]): T[] {
  return children.filter((node) => (node.kind === "folder" || node.kind === "document") && !isHiddenPage(node)).sort((a, b) => a.ordinal - b.ordinal);
}

/** The home page of a folder among its entries, when it has one. */
export const homeOf = (entries: readonly BrainNode[]): BrainNode | undefined => entries.find(isHomePage);

/** What the tree knows of one level: the children loaded so far, how many the folder has and whether more are loading. */
export interface TreeLevel {
  items: BrainNode[];
  total: number;
  loading: boolean;
  error?: string | undefined;
}

export interface TreeRow {
  node: BrainNode;
  depth: number;
  /** Folders open and close; a page is a leaf (its sections are the table of contents, not the tree). */
  expandable: boolean;
  open: boolean;
}

/**
 * The rows the tree shows, top to bottom: the levels loaded below a folder, those folders that are open going deeper.
 * A level that is not loaded yet shows no rows.
 */
export function treeRows(rootId: string, levels: ReadonlyMap<string, TreeLevel>, open: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (parentId: string, depth: number): void => {
    for (const node of pageEntries(levels.get(parentId)?.items ?? [])) {
      const expandable = node.kind === "folder" && node.children > 0;
      const isOpen = expandable && open.has(node.id);
      rows.push({ node, depth, expandable, open: isOpen });
      if (isOpen) walk(node.id, depth + 1);
    }
  };
  walk(rootId, 0);
  return rows;
}

/** The folders to open so that `path` is in view: every folder above it, root first (the Brain's folder ids). */
export function foldersAbove(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment !== "");
  // The last segment is the page itself, or the folder being shown (that one is opened as well).
  const upTo = isPagePath(path) ? segments.length - 1 : segments.length;
  return [BRAIN_ROOT_ID, ...Array.from({ length: upTo }, (_, index) => `${segments.slice(0, index + 1).join("/")}/`)];
}

/** What a person is told when the API refuses a read (Project Access): a person without it, an administrator included, gets a 403. */
export const WIKI_NO_ACCESS = "You do not have access to this project.";

/** A read of the wiki (an `ApiError` carries its HTTP `status`) that says plainly when the project is not the person's, and is never tried again by itself. */
export async function wikiRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (failure) {
    if (failure instanceof Error && (failure as { status?: unknown }).status === 403) throw new Error(WIKI_NO_ACCESS, { cause: failure });
    throw failure;
  }
}

/** What a link of a wiki page does: a page of the repository opens in the reader, an attachment is served by the API. */
export type WikiLinkAction =
  | { kind: "page"; path: string; anchor?: string }
  | { kind: "attachment"; path: string }
  /** Any other file of the repository: left to the shared document drawer. */
  | { kind: "other"; path: string };

/** A file in an `_attachments/` folder that is not a page: the only files the attachment route serves. */
export const isAttachmentPath = (path: string): boolean => !isPagePath(path) && path.split("/").slice(0, -1).includes("_attachments");

/** Decides what a link target (already resolved against the page it is written in) does inside the reader. */
export function wikiLinkAction(target: { path: string; anchor?: string | undefined }): WikiLinkAction {
  if (isPagePath(target.path)) return { kind: "page", path: target.path, ...(target.anchor !== undefined && target.anchor !== "" && { anchor: target.anchor }) };
  if (isAttachmentPath(target.path)) return { kind: "attachment", path: target.path };
  return { kind: "other", path: target.path };
}

/** The address of an attachment at a commit: the API serves it with a fixed content type and no scripts. */
export function attachmentUrl(projectId: string, path: string, ref: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/documents/attachment?${new URLSearchParams({ ref, path }).toString()}`;
}

/** The id of the heading an address names (`#install`), as the renderer wrote it: the fragment without `#`, decoded. */
export function headingIdOfHash(hash: string): string {
  return decode(hash.startsWith("#") ? hash.slice(1) : hash);
}

// ---- Versions ---------------------------------------------------------------------------------------------------
// A page has its history (the commits that changed it, renames followed), can be read as it was at one of them and can
// be compared at two of them. Which of these a page shows is in the address too: `?view=history`, `?version=<sha>`
// and `?view=compare&from=<sha>&to=<sha>`; no parameter is the current page.

export type PageMode = { mode: "page" } | { mode: "history" } | { mode: "version"; sha: string } | { mode: "compare"; from: string; to: string };

const COMMIT_ID = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

/** What an address asks of a page; anything that is not a commit id (the API would refuse it) is read as the current page. */
export function readPageMode(params: URLSearchParams): PageMode {
  const version = (params.get("version") ?? "").toLowerCase();
  if (COMMIT_ID.test(version)) return { mode: "version", sha: version };
  const view = params.get("view");
  if (view === "history") return { mode: "history" };
  const from = (params.get("from") ?? "").toLowerCase();
  const to = (params.get("to") ?? "").toLowerCase();
  if (view === "compare" && COMMIT_ID.test(from) && COMMIT_ID.test(to)) return { mode: "compare", from, to };
  return { mode: "page" };
}

/** The address of a page in one of its modes (the current page without one). */
export function wikiPageLink(projectId: string, path: string, mode: PageMode = { mode: "page" }): string {
  const params = new URLSearchParams({ project: projectId });
  if (mode.mode === "history") params.set("view", "history");
  if (mode.mode === "version") params.set("version", mode.sha);
  if (mode.mode === "compare") {
    params.set("view", "compare");
    params.set("from", mode.from);
    params.set("to", mode.to);
  }
  const route = path === "" ? WIKI_BASE : `${WIKI_BASE}/${path.split("/").map(encodeURIComponent).join("/")}`;
  return `${route}?${params.toString()}`;
}

/**
 * The two versions to compare, older first, whichever order they were picked in: the history lists the newest first,
 * so the one further down is the older. A version the list does not hold (an older page not loaded yet) is older than
 * every one it does hold.
 */
export function comparePair(shas: readonly string[], a: string, b: string): { from: string; to: string } {
  const place = (sha: string): number => {
    const index = shas.indexOf(sha);
    return index < 0 ? shas.length : index;
  };
  return place(a) >= place(b) ? { from: a, to: b } : { from: b, to: a };
}

/** The versions picked for a comparison after a click on one: two at most, the one picked longest ago is let go. */
export function togglePicked(picked: readonly string[], sha: string): string[] {
  if (picked.includes(sha)) return picked.filter((entry) => entry !== sha);
  return [...picked, sha].slice(-2);
}

/** What a comparison changed, in a few words. */
export function compareSummary(result: { status: "unchanged" | "added" | "deleted" | "modified"; added: number; removed: number }): string {
  const lines = (count: number): string => `${count} ${count === 1 ? "line" : "lines"}`;
  if (result.status === "unchanged") return "No difference: the two versions hold the same text";
  if (result.status === "added") return `The page was added: ${lines(result.added)}`;
  if (result.status === "deleted") return `The page was deleted: ${lines(result.removed)}`;
  return `${lines(result.added)} added, ${result.removed} removed`;
}

// ---- Images -----------------------------------------------------------------------------------------------------
// A wiki page may show images that are attachments of the repository (an `_attachments/` folder). The browser never
// fetches anything else by itself: a remote image would tell its host who reads which page (design-reader-security 11).

const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;

/** What a Markdown image `![alt](src)` of the page at `from` becomes in the reader. */
export type ImageSource =
  /** An image attachment of the repository: shown from the API's attachment route. */
  | { kind: "attachment"; path: string }
  /** An image on the web: not loaded, shown as a link the reader may follow. */
  | { kind: "external"; href: string }
  /** Nothing is loaded: the alt text is shown (a data URL, a file outside `_attachments/`, any other type or scheme). */
  | { kind: "none" };

/** Decides what an image source is, resolving a relative one against the page it is written in. */
export function imageSource(src: string | undefined, from: string): ImageSource {
  if (src === undefined || src.trim() === "") return { kind: "none" };
  const target = resolveDocumentLink(src, from);
  if (target.kind === "external") return { kind: "external", href: target.href };
  if (target.kind === "document" && isAttachmentPath(target.path) && IMAGE_FILE.test(target.path)) return { kind: "attachment", path: target.path };
  return { kind: "none" };
}

// ---- Search -----------------------------------------------------------------------------------------------------
// The reader's search box is the Brain's exact text search (`brain/grep`), narrowed by one space and one label; it is
// not ranked (ADR-0097). What was asked lives in the address (`/wiki?project=…&q=…&space=…&label=…`), so a result list
// can be shared and a reload shows the same list.

/** What the search box asks: a text and, optionally, the space and the label the pages must have. */
export interface WikiSearch {
  q: string;
  /** A space key in capitals, or "". */
  space: string;
  /** A label as the Brain writes it (lowercase, `a-z0-9-`), or "". */
  label: string;
}

export const NO_SEARCH: WikiSearch = { q: "", space: "", label: "" };

const SPACE_KEY = /^[A-Za-z][A-Za-z0-9]{1,9}$/;

/** A space key as the API takes it: capitals; "" for anything that is not a key (it would only be refused). */
export const normalizeSpace = (value: string): string => (SPACE_KEY.test(value.trim()) ? value.trim().toUpperCase() : "");

/** A label as the Brain writes it; "" when nothing of it is left. */
export const normalizeLabel = (value: string): string => brainLabels([value])[0] ?? "";

/** The search an address asks (what the reader shows when `q` is set). */
export function readWikiSearch(params: URLSearchParams): WikiSearch {
  return { q: (params.get("q") ?? "").trim(), space: normalizeSpace(params.get("space") ?? ""), label: normalizeLabel(params.get("label") ?? "") };
}

/** The address of a search of a project's wiki. */
export function wikiSearchLink(projectId: string, search: WikiSearch): string {
  const params = new URLSearchParams({ project: projectId });
  if (search.q.trim() !== "") params.set("q", search.q.trim());
  if (search.space !== "") params.set("space", search.space);
  if (search.label !== "") params.set("label", search.label);
  return `${WIKI_BASE}?${params.toString()}`;
}

/** One line of a page that holds the text, with the heading it is under (to scroll to). */
export interface SearchLine {
  line: number;
  excerpt: string;
  /** The id of the heading (or card) the line is in; null for a line outside any heading. */
  anchor: string | null;
  /** The title of that heading. */
  section: string | null;
}

/** A page with the lines of it that matched. */
export interface SearchHit {
  path: string;
  title: string;
  /** The folders above the page, from the top, without the repository root. */
  breadcrumb: string[];
  space: string | null;
  labels: string[];
  lines: SearchLine[];
}

/** Groups the matches of a search by page, in the order the first match of each came; archived pages and templates are left out. */
export function searchHits(matches: readonly BrainGrepMatch[]): SearchHit[] {
  const hits = new Map<string, SearchHit>();
  for (const match of matches) {
    if (isHiddenPage(match.node)) continue;
    const path = match.node.path;
    let hit = hits.get(path);
    if (hit === undefined) {
      const crumbs = match.breadcrumb.filter((crumb) => crumb.kind !== "root");
      const own = crumbs.find((crumb) => crumb.kind === "document");
      hit = {
        path,
        title: own?.title ?? (match.node.kind === "document" ? match.node.title : nameOf(path)),
        breadcrumb: crumbs.filter((crumb) => crumb.kind === "folder").map((crumb) => crumb.title),
        // Only the document node carries a page's space and labels (a section or a card holds none): see withDocuments.
        space: match.node.kind === "document" ? match.node.space : null,
        labels: match.node.kind === "document" ? match.node.labels : [],
        lines: [],
      };
      hits.set(path, hit);
    }
    // The page still counts when the text is only in its front matter, but those lines are not what a person reads.
    if (isFrontMatterLine(match.node.kind, match.excerpt)) continue;
    const inHeading = match.node.kind === "section" || match.node.kind === "card";
    hit.lines.push({ line: match.line, excerpt: readableExcerpt(match.excerpt), anchor: inHeading ? match.node.anchor : null, section: inHeading ? match.node.title : null });
  }
  return [...hits.values()];
}

/** How many pages of a result list get their document node looked up: the list shows the first ones, and the filters follow them. */
export const HIT_DOCUMENT_CAP = 30;

/** The paths of the pages whose document node a result list needs, the first `HIT_DOCUMENT_CAP` of the hits, each once. */
export const hitPaths = (hits: readonly Pick<SearchHit, "path">[]): string[] => [...new Set(hits.map((hit) => hit.path))].slice(0, HIT_DOCUMENT_CAP);

/**
 * The hits with what only a page's document node knows: its title, space and labels (a grep match is the section or card
 * a line is in, which holds none of them). A page whose document is archived or a template is dropped. A hit without
 * its document (not looked up, or the lookup failed) is kept as it is.
 */
export function withDocuments(hits: readonly SearchHit[], documents: ReadonlyMap<string, BrainNode>): SearchHit[] {
  return hits.flatMap((hit) => {
    const document = documents.get(hit.path);
    if (document === undefined) return [hit];
    if (isHiddenPage(document)) return [];
    return [{ ...hit, title: document.title, space: document.space, labels: document.labels }];
  });
}

/** A line of a page's front matter: `---`, `key: value`, `- item` or an indented continuation. */
const FRONT_MATTER_LINE = /^(---|\.\.\.|[A-Za-z_][\w -]*:(\s|$)|\s*-(\s|$)|\s+\S)/;

/**
 * Whether a matched line is in the front matter of its page. The builder attaches a line before the first heading to the
 * page itself (a section or a card holds the lines under a heading), and in a page of the document repo that is its front
 * matter; a line of such a shape there is metadata, not text for a reader.
 */
export const isFrontMatterLine = (kind: string, excerpt: string): boolean => kind === "document" && FRONT_MATTER_LINE.test(excerpt);

/** An excerpt as a person reads it: a Markdown link `[text](url)` or image `![alt](url)` is its text, still plain text. */
export const readableExcerpt = (excerpt: string): string => excerpt.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");

/** How the result list counts its pages: "1 page contains …", "3 pages contain …". */
export const hitCount = (pages: number, text: string): string => `${pages} ${pages === 1 ? "page contains" : "pages contain"} “${text}”`;

/** The address of one line of a hit: the page, scrolled to the heading the line is under. */
export const searchLineLink = (projectId: string, hit: Pick<SearchHit, "path">, line: Pick<SearchLine, "anchor">): string => wikiLink(projectId, hit.path, line.anchor ?? undefined);

/** The spaces and labels the hits show, each once and sorted: what the filters offer to narrow a search. */
export function searchFacets(hits: readonly SearchHit[]): { spaces: string[]; labels: string[] } {
  const spaces = new Set<string>();
  const labels = new Set<string>();
  for (const hit of hits) {
    if (hit.space !== null) spaces.add(hit.space.toUpperCase());
    for (const label of hit.labels) labels.add(label);
  }
  return { spaces: [...spaces].sort(), labels: [...labels].sort() };
}

/** A text cut into the parts that are the searched text (case does not matter) and those that are not, for marking it. */
export function highlightParts(text: string, needle: string): Array<{ text: string; match: boolean }> {
  const wanted = needle.trim().toLowerCase();
  const lower = text.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let at = 0;
  if (wanted !== "") {
    for (let index = lower.indexOf(wanted); index >= 0; index = lower.indexOf(wanted, index + wanted.length)) {
      if (index > at) parts.push({ text: text.slice(at, index), match: false });
      parts.push({ text: text.slice(index, index + wanted.length), match: true });
      at = index + wanted.length;
    }
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts;
}
