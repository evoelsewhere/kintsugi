// Domain of member monitoring (ADR-0069): what members' connections did in a project. A record holds
// names, counts and a short summary, never document content.

export const MEMBER_ACTIVITY_SUMMARY_MAX = 500;
export const MEMBER_ACTIVITY_DETAIL_MAX_BYTES = 4096;
/** The most records one user can add in an hour; bounds what a connection can write. */
export const MEMBER_ACTIVITY_HOURLY_LIMIT = 600;

export interface MemberActivityInput {
  userId: string;
  projectId: string;
  /** The plugin the activity belongs to, when it does. */
  pluginName?: string;
  /** The kind of client (claude-code, codex, ...), as the plugin reports it. */
  harness?: string;
  /** plugin.download, document.read, or a kind a plugin records. */
  kind: string;
  summary?: string;
  detail?: Record<string, unknown>;
}

export interface MemberActivity {
  id: string;
  at: string;
  userId: string;
  username: string;
  projectId: string;
  pluginName?: string;
  harness?: string;
  kind: string;
  summary: string;
  detail: Record<string, unknown>;
}

export interface MemberActivityFilter {
  projectId: string;
  userId?: string;
  pluginName?: string;
  kind?: string;
  limit: number;
  offset: number;
}

/** One member in the monitoring overview of a project. */
export interface MemberUsage {
  userId: string;
  username: string;
  displayName: string;
  lastSeenAt: string;
  events: number;
  /** Events by kind. */
  kinds: Record<string, number>;
  /** Events by plugin; activity outside any plugin is not listed. */
  plugins: Record<string, number>;
}

export interface MemberUsageSummary {
  projectId: string;
  from: string;
  to: string;
  members: MemberUsage[];
}
