// What the wiki reader says about the document repository: the address of a page, which Brain nodes make the page tree
// and in what order, and whether a project's wiki is on. Kept apart from the views so it can be tested.
// The reader is read-only (ADR-0096, ADR-0097): everything comes from the Brain's tree and the documents routes.

import type { BrainNode } from "@kintsugi/domain";
import { BRAIN_ROOT_ID } from "@kintsugi/domain";

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
