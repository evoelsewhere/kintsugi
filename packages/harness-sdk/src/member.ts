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

/** The operations shared by the CLI, the local MCP adapter and the API composition. */
export interface MemberPort {
  listProjects(query: ProjectQuery): Promise<ListResult<ProjectSummary>>;
  documentTree(query: DocumentTreeQuery): Promise<DocumentTree>;
  documentFile(query: DocumentFileQuery): Promise<DocumentFile>;
}
