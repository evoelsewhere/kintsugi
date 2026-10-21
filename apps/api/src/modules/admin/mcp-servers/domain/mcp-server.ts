// An MCP server the runtime may give to agents (ADR-0047): an HTTP endpoint an administrator
// registered under an id. Header values are credentials: stored encrypted, never returned.

export interface McpServerRecord {
  id: string;
  url: string;
  description?: string;
  enabled: boolean;
  /** Per-request timeout, seconds. */
  timeoutSec: number;
  /** Tool-name patterns (`*` matches any characters) allowed besides the tools the server marks read-only. */
  allowedTools: string[];
  /** The names of the stored headers (lower-case); the values are never exposed. */
  headerNames: string[];
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Application command: register or replace a server. */
export interface RegisterMcpServer {
  id: string;
  url: string;
  description?: string;
  enabled: boolean;
  timeoutSec: number;
  allowedTools: string[];
  /** Header values; `null` keeps the stored value on a replace. Names are case-insensitive. */
  headers: Record<string, string | null>;
  actor?: string;
}
