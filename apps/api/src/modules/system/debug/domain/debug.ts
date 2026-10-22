// Domain of the debug MCP server (ADR-0056): the ports its tools read through. Everything is read-only and answers
// plain JSON, so the application layer can bound and serialize it without knowing where it came from.

export type Json = Record<string, unknown>;

export const LOG_SERVICES = ["api", "worker"] as const;
export type LogService = (typeof LOG_SERVICES)[number];
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RunFilter {
  projectId?: string;
  applicationId?: string;
  statuses?: readonly string[];
  limit: number;
}

export interface EventQuery {
  runId: string;
  /** Events after this id (ascending) or before it (descending). */
  cursor?: string;
  order: "asc" | "desc";
  limit: number;
  kinds?: readonly string[];
  stepId?: string;
  attempt?: number;
  /** A case-insensitive text the message must contain. */
  text?: string;
}

export interface LogQuery {
  service?: LogService;
  minLevel: LogLevel;
  /** Lines from this time on. */
  since?: Date;
  until?: Date;
  /** A case-insensitive regular expression the message must match. */
  pattern?: string;
  limit: number;
}

/** Reads the database: runs, logs, queues, workers, repositories and tables. */
export abstract class DebugStore {
  abstract runs(filter: RunFilter): Promise<Json[]>;
  /** A top-level run with its steps, attempts, document write and artifact count; undefined when unknown. */
  abstract run(runId: string): Promise<Json | undefined>;
  /** One step (child run), with its inputs and summary as stored. */
  abstract step(stepId: string): Promise<Json | undefined>;
  abstract events(query: EventQuery): Promise<Json[]>;
  /** What failed in a run: the failed steps, the events that matter and the warnings and errors the services logged meanwhile. */
  abstract failure(runId: string): Promise<Json | undefined>;
  abstract telemetry(runId: string): Promise<Json>;
  abstract logs(query: LogQuery): Promise<Json[]>;
  /** The lines of one service just before and after a log line. */
  abstract logsAround(id: string, before: number, after: number): Promise<Json[]>;
  /** What was captured: lines, oldest and newest, per service. */
  abstract logCapture(): Promise<Json>;
  abstract status(): Promise<Json>;
  abstract queues(): Promise<Json>;
  abstract repositories(): Promise<Json[]>;
  /** The status and finish time of runs by id, for the workspaces on disk. */
  abstract runStates(ids: readonly string[]): Promise<Map<string, Json>>;
  abstract tables(schema: string | undefined, table: string | undefined): Promise<Json>;
  /** One read-only statement; the caller has checked it. */
  abstract query(sql: string, limit: number): Promise<Json>;
}

export interface TreeEntry {
  path: string;
  type: "dir" | "file" | "link" | "other";
  size?: number;
  /** For a folder the walk did not enter: how many entries it holds. */
  entries?: number;
}

export interface FileText {
  path: string;
  size: number;
  offset: number;
  length: number;
  truncated: boolean;
  /** Absent for a binary file. */
  text?: string;
  binary: boolean;
}

/** Reads the job workspaces on the data volume (ADR-0055). */
export abstract class WorkspaceFiles {
  abstract jobs(limit: number): Promise<Array<{ id: string; modifiedAt: string; entries: string[]; manifest?: Json }>>;
  abstract exists(jobId: string): Promise<boolean>;
  abstract tree(jobId: string, path: string, depth: number, limit: number): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  abstract read(jobId: string, path: string, offset: number, length: number): Promise<FileText>;
  /** `workspace.json` and `.state/ledger.json`, parsed; undefined for one that is not there. */
  abstract state(jobId: string): Promise<{ manifest?: unknown; ledger?: unknown; stepFolders: string[] }>;
  /** Free and total bytes of the volume the data directory is on, and the data directory itself. */
  abstract disk(): Promise<Json>;
}
