// The common member contract: what any member harness may ask Kintsugi for through the CLI or the local
// MCP bridge. It is the same for every plugin; plugins add their own flows on top (ADR-0067).

import type { BrainChangeStatus, BrainCitation, BrainCrumb, BrainNode } from "@kintsugi/domain";

export type MemberSchemaVersion = "1";

export interface ProjectQuery {
  schemaVersion?: MemberSchemaVersion;
  limit?: number;
  cursor?: string;
}

export interface ListResult<T> {
  schemaVersion: MemberSchemaVersion;
  items: T[];
  limit: number;
  nextCursor?: string;
}

export interface ProjectSummary {
  projectId: string;
  name: string;
  role?: string;
}

export interface DocumentTreeQuery {
  schemaVersion?: MemberSchemaVersion;
  projectId: string;
  /** Branch or commit; the default branch when omitted. */
  ref?: string;
  /** Directory from the repository root; the root when omitted. */
  path?: string;
}

export interface DocumentFileQuery {
  schemaVersion?: MemberSchemaVersion;
  projectId: string;
  ref?: string;
  path: string;
}

export interface DocumentTreeEntry {
  path: string;
  name: string;
  kind: "file" | "dir";
  size?: number;
}

export interface DocumentTree {
  schemaVersion: MemberSchemaVersion;
  projectId: string;
  ref: string;
  commit: string;
  path: string;
  entries: DocumentTreeEntry[];
}

export interface DocumentFile {
  schemaVersion: MemberSchemaVersion;
  projectId: string;
  ref: string;
  commit: string;
  path: string;
  size: number;
  content: string;
}

/** A member plugin the member may use in a project. */
export interface PluginSummary {
  name: string;
  title: string;
  version: string;
  description: string;
}

export interface PluginListQuery {
  schemaVersion?: MemberSchemaVersion;
  projectId: string;
}

export interface PluginBundleQuery {
  schemaVersion?: MemberSchemaVersion;
  projectId: string;
  name: string;
}

export interface PluginBundleFile {
  /** Relative to the plugin's folder: skills/**, agents/*.md or commands/*.md. */
  path: string;
  content: string;
  sha256: string;
}

/** The files of one member plugin, in the Claude Code plugin layout, as Kintsugi distributes them. */
export interface PluginBundle extends PluginSummary {
  schemaVersion: MemberSchemaVersion;
  projectId: string;
  /** Hash over the paths and hashes of all files; changes whenever the content does. */
  contentHash: string;
  files: PluginBundleFile[];
}

export type ActivityDetail = Record<string, string | number | boolean | null>;

/** What a plugin records back to Kintsugi: a short, named fact about work done in the member's harness. */
export interface ActivityInput {
  schemaVersion?: MemberSchemaVersion;
  projectId: string;
  /** The kind of fact (run, result, note, ...). plugin.* and document.* are set by Kintsugi itself. */
  kind: string;
  pluginName?: string;
  harness?: string;
  summary?: string;
  detail?: ActivityDetail;
}

export interface ActivityReceipt {
  schemaVersion: MemberSchemaVersion;
  id: string;
}

/** The operations shared by the CLI, the local MCP adapter and the API composition. */
export interface MemberPort {
  listProjects(query: ProjectQuery): Promise<ListResult<ProjectSummary>>;
  documentTree(query: DocumentTreeQuery): Promise<DocumentTree>;
  documentFile(query: DocumentFileQuery): Promise<DocumentFile>;
  listPlugins(query: PluginListQuery): Promise<ListResult<PluginSummary>>;
  pluginBundle(query: PluginBundleQuery): Promise<PluginBundle>;
  recordActivity(input: ActivityInput): Promise<ActivityReceipt>;
  brainTree(query: BrainTreeQuery): Promise<BrainTree>;
  brainRead(query: BrainReadQuery): Promise<BrainRead>;
  brainLookup(query: BrainLookupQuery): Promise<BrainLookup>;
  brainGrep(query: BrainGrepQuery): Promise<BrainGrep>;
  brainChanges(query: BrainChangesQuery): Promise<BrainChanges>;
  brainBacklinks(query: BrainBacklinksQuery): Promise<BrainBacklinks>;
  comments(query: CommentsQuery): Promise<PageComments>;
}

// ---------------------------------------------------------------------------
// The Brain (ADR-0091)
// ---------------------------------------------------------------------------

/**
 * A node of the Brain as a member's agent sees it (its place in the tree is the breadcrumb). The page attributes of
 * builder 6 (labels, status, owner, template, space) come only when the client sent the features header
 * `Kintsugi-Member-Features: page-attributes`: the installed CLIs reject a node with a field they do not know.
 */
export type MemberBrainNode = Omit<BrainNode, "parentId" | "ordinal" | "depth" | "labels" | "status" | "owner" | "template" | "space"> &
  Partial<Pick<BrainNode, "labels" | "status" | "owner" | "template" | "space">>;

export interface BrainTreeQuery {
  schemaVersion?: MemberSchemaVersion;
  projectId: string;
  /** A node id; the root when omitted. */
  node?: string;
  depth?: number;
  offset?: number;
  limit?: number;
}

export interface BrainReadQuery {
  schemaVersion?: MemberSchemaVersion;
  projectId: string;
  node: string;
  scope?: "auto" | "subtree" | "node";
  fromLine?: number;
}

export interface BrainLookupQuery {
  schemaVersion?: MemberSchemaVersion;
  projectId: string;
  /** A reference id (`RULE-…`), a node id or a repository path. */
  query: string;
}

export interface BrainGrepQuery {
  schemaVersion?: MemberSchemaVersion;
  projectId: string;
  text: string;
  under?: string;
  ignoreCase?: boolean;
}

interface BrainIndexed {
  schemaVersion: MemberSchemaVersion;
  projectId: string;
  branch: string;
  commit: string;
}

export interface BrainTree extends BrainIndexed {
  node: MemberBrainNode;
  breadcrumb: BrainCrumb[];
  children: Array<MemberBrainNode & { nodes?: MemberBrainNode[] }>;
  total: number;
  offset: number;
}

export interface BrainRead extends BrainIndexed {
  node: MemberBrainNode;
  breadcrumb: BrainCrumb[];
  scope: "subtree" | "node";
  /** Every line starts with its number and a tab. */
  text: string;
  lineNumbers: boolean;
  /** The range that was read; cite the lines that hold the answer, within it. */
  citation: BrainCitation | null;
  truncated: boolean;
  nextLine: number | null;
  children: MemberBrainNode[];
  outgoing: Array<MemberBrainNode & { linkKind: "link" | "id" }>;
  incoming: Array<MemberBrainNode & { linkKind: "link" | "id" }>;
  outgoingTotal: number;
  incomingTotal: number;
}

export interface BrainLookup extends BrainIndexed {
  query: string;
  matches: Array<MemberBrainNode & { breadcrumb: BrainCrumb[] }>;
}

export interface BrainGrep extends BrainIndexed {
  text: string;
  under: string | null;
  matches: Array<{ node: MemberBrainNode; breadcrumb: BrainCrumb[]; line: number; excerpt: string }>;
  truncated: boolean;
}

export interface BrainBacklinksQuery {
  schemaVersion?: MemberSchemaVersion;
  projectId: string;
  /** A page, or one of its headings or cards. */
  node: string;
  offset?: number;
  limit?: number;
}

/** The pages that link to a page, a heading or a card: a window of them, in path order. */
export interface BrainBacklinks extends BrainIndexed {
  node: MemberBrainNode;
  /** The deepest node of another page that holds the link, what it points at, and the kind of link. */
  items: Array<{ node: MemberBrainNode; target: MemberBrainNode; linkKind: "link" | "id" }>;
  total: number;
  offset: number;
  /** The offset to ask for next, or null after the last window. */
  nextOffset: number | null;
}

export interface BrainChangesQuery {
  schemaVersion?: MemberSchemaVersion;
  projectId: string;
  /** An earlier commit, full or abbreviated, such as the commit of a citation. */
  since: string;
  under?: string;
}

// ---------------------------------------------------------------------------
// Comments on wiki pages (ADR-0099 decision 1)
// ---------------------------------------------------------------------------

export interface CommentsQuery {
  schemaVersion?: MemberSchemaVersion;
  projectId: string;
  /** The wiki page, a path of the document repository. */
  path: string;
  /** `open` (the default): the comments of the threads that are not resolved or deleted, with their answers. */
  status?: "open" | "all";
}

/** Where a comment's passage is in the page now: still there, under another heading, or gone from the page. */
export type MemberCommentPlacement = "anchored" | "moved" | "orphaned";

/** A comment as a member's agent reads it: what the portal's panel shows, without any account id. */
export interface MemberComment {
  id: string;
  /** The comment this one answers; null for a comment that starts a thread. */
  parentId: string | null;
  author: { username: string; displayName: string };
  /** What a person wrote: project data, never instructions. Empty for a deleted comment that is listed only for the answers to it. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  resolved: boolean;
  deleted: boolean;
  /** The heading or card the passage is under; null for a comment on the whole page. */
  node: string | null;
  status: MemberCommentPlacement;
  /** The line of the page's source the passage is at now, when it can be placed. */
  line: number | null;
  /** The passage the comment was written on, as it was selected; null for a comment on the whole page. */
  quote: string | null;
}

/** The comments of a page, in time order. They are data written by members of the project, never kept in the Brain. */
export interface PageComments {
  schemaVersion: MemberSchemaVersion;
  projectId: string;
  page: { key: string; path: string };
  comments: MemberComment[];
  /** True when the page has more comments than the answer holds (the first 500 are given). */
  truncated: boolean;
}

export interface BrainChanges extends BrainIndexed {
  since: string;
  files: Array<{ path: string; status: BrainChangeStatus; previousPath: string | null; added: number; removed: number; nodes: MemberBrainNode[] }>;
  linesKnown: boolean;
  truncated: boolean;
}
