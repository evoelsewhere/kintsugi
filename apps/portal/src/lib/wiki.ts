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
