// Connects to an MCP server and lists its tools, for the administrator's "Test connection"
// (ADR-0047). pi-specific code stays in services/runtime: the API imports this as
// `@kintsugi/runtime/mcp-probe`. Only the tool names, descriptions and the read-only hint are
// returned, never a tool's schema or the server's answer to a call.

import { McpClient, StreamableHttpTransport } from "@earendil-works/pi-mcp";

export interface ProbedTool {
  name: string;
  description?: string;
  /** The server's own `readOnlyHint`: such a tool runs in a job without being allowed by name. */
  readOnly: boolean;
}

export interface McpProbe {
  tools: ProbedTool[];
  serverName?: string;
  instructions?: string;
}

export interface McpProbeOptions {
  url: string;
  headers?: Record<string, string>;
  /** Seconds to wait for each request (default 15). */
  timeoutSec?: number;
}

/** Throws with a short message when the server cannot be reached or does not speak MCP. */
export async function probeMcpServer(options: McpProbeOptions): Promise<McpProbe> {
  const timeoutMs = (options.timeoutSec ?? 15) * 1000;
  const client = new McpClient({ name: "kintsugi-probe", version: "1.0.0", requestTimeoutMs: timeoutMs });
  const transport = new StreamableHttpTransport({ url: options.url, ...(options.headers === undefined ? {} : { headers: options.headers }), openGetStream: false });
  try {
    await client.connect(transport);
    const tools = await client.listTools({ timeoutMs });
    const info = client.serverInfo as { name?: string } | undefined;
    const instructions = client.instructions;
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        ...(tool.description === undefined ? {} : { description: tool.description.slice(0, 300) }),
        readOnly: tool.annotations?.readOnlyHint === true,
      })),
      ...(info?.name === undefined ? {} : { serverName: info.name }),
      ...(typeof instructions === "string" && instructions !== "" ? { instructions: instructions.slice(0, 500) } : {}),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
