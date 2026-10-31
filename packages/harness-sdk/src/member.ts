// The common member contract: what any member harness may ask Kintsugi for through the CLI or the local
// MCP bridge. It is the same for every plugin; plugins add their own flows on top (ADR-0067).

import type { BrainCitation, BrainCrumb, BrainNode } from "@kintsugi/domain";

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
}

// ---------------------------------------------------------------------------
// The Brain (ADR-0091)
// ---------------------------------------------------------------------------

/** A node of the Brain as a member's agent sees it (its place in the tree is the breadcrumb). */
export type MemberBrainNode = Omit<BrainNode, "parentId" | "ordinal" | "depth">;

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
