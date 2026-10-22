// Typed access to the MCP server registry (Settings → MCP servers, ADR-0047). Mirrors
// apps/api → modules/admin/mcp-servers. Header values are write-only.

import { apiGet, apiSend } from "../api";

export interface McpServerView {
  id: string;
  url: string;
  description?: string;
  enabled: boolean;
  timeoutSec: number;
  allowedTools: string[];
  /** The names of the stored headers; their values are never returned. */
  headerNames: string[];
  /** What every tool of the server is named in front of: `mcp__tracker__`. */
  toolPrefix: string;
  /** The entry an agent puts in its tools to name the server: `mcp__tracker__*`. */
  toolEntry: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** What an agent builder may see of a server: no address, no headers. */
export interface McpServerChoice {
  id: string;
  description?: string;
  enabled: boolean;
  toolEntry: string;
}

export interface McpServerInput {
  url: string;
  description?: string;
  enabled: boolean;
  timeoutSec: number;
  allowedTools: string[];
  /** A value of null keeps the stored one. */
  headers: Record<string, string | null>;
}

export interface McpTestResult {
  ok: boolean;
  message: string;
  serverName?: string;
  tools: Array<{ name: string; description?: string; readOnly: boolean; allowed: boolean }>;
}

const BASE = "/api/admin/mcp-servers";

export const mcpServersApi = {
  list: () => apiGet<McpServerView[]>(BASE),
  /** The registered servers an agent can name (agents.manage or mcp.manage). */
  choices: () => apiGet<McpServerChoice[]>(`${BASE}/choices`),
  create: (id: string, input: McpServerInput) => apiSend<McpServerView>(BASE, "POST", { id, ...input }),
  replace: (id: string, input: McpServerInput) => apiSend<McpServerView>(`${BASE}/${encodeURIComponent(id)}`, "PATCH", input),
  remove: (id: string) => apiSend<void>(`${BASE}/${encodeURIComponent(id)}`, "DELETE"),
  test: (id: string) => apiSend<McpTestResult>(`${BASE}/${encodeURIComponent(id)}/test`, "POST"),
};
