// Ports of the MCP server registry. The Postgres adapter implements the repository; the runtime's
// MCP client implements the probe.

import type { McpServerRecord, RegisterMcpServer } from "./mcp-server.js";

export abstract class McpServerRepository {
  abstract list(): Promise<McpServerRecord[]>;
  abstract get(id: string): Promise<McpServerRecord | undefined>;
  abstract create(input: RegisterMcpServer): Promise<McpServerRecord>;
  abstract replace(id: string, input: RegisterMcpServer): Promise<McpServerRecord | undefined>;
  abstract remove(id: string): Promise<boolean>;
  /** The header values in plaintext, for the connection test only; undefined when the server does not exist. */
  abstract resolveHeaders(id: string): Promise<Record<string, string> | undefined>;
}

export interface ProbedMcpTool {
  name: string;
  description?: string;
  readOnly: boolean;
}

export interface McpProbeResult {
  tools: ProbedMcpTool[];
  serverName?: string;
  instructions?: string;
}

export abstract class McpProbe {
  /** Connects and lists the tools; rejects with a short message when the server cannot be used. */
  abstract probe(options: { url: string; headers: Record<string, string>; timeoutSec: number }): Promise<McpProbeResult>;
}
