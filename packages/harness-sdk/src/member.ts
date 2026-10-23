// The common member contract: what any member harness may ask Kintsugi for through the CLI or the local
// MCP bridge. It is the same for every plugin; plugins add their own flows on top (ADR-0067).

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
}
