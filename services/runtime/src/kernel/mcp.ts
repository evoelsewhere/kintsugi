// MCP servers in the kernel (ADR-0047): the HTTP endpoints an admin registered, for the agents that
// name them in `tools`. pi's MCP extension connects them and registers their tools as
// `mcp__<server>__<tool>`. The kernel adds three rules on top:
//
//  - only HTTP servers, from the JobSpec: nothing is read from an `mcp.json`, no command is started;
//  - a tool runs only if its server marks it read-only (`readOnlyHint`) or the admin allowed it by
//    name: a call to any other MCP tool is refused, whether the model or a codemode script makes it;
//  - the tools are callable from codemode scripts only when the agent has codemode (so a long answer
//    stays out of the context), and declared to the model directly otherwise.

import { createMcpExtension, type ExtensionAPI, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { matchesToolPattern, mcpToolPrefix } from "@kintsugi/domain";
import type { McpServerSpec } from "@kintsugi/runtime-sdk";
import type { BlockedCallSink } from "./policy.js";

export const MCP_TOOL_PREFIX = "mcp__";

export interface McpKernel {
  /** pi extensions to load, in order. */
  factories: ExtensionFactory[];
  /** Whether the kernel lets this MCP tool run: read-only by the server's own hint, or allowed by the admin. */
  allows(tool: string): boolean;
}

/** The server an MCP tool name belongs to, and the tool's name without the server prefix. */
export function splitMcpTool(servers: readonly McpServerSpec[], tool: string): { server: McpServerSpec; name: string } | undefined {
  for (const server of servers) {
    const prefix = mcpToolPrefix(server.name);
    if (tool.startsWith(prefix)) return { server, name: tool.slice(prefix.length) };
  }
  return undefined;
}

export function createMcpKernel(options: { servers: readonly McpServerSpec[]; codemode: boolean; onBlocked: BlockedCallSink }): McpKernel {
  let pi: ExtensionAPI | undefined;

  const allows = (tool: string): boolean => {
    const parts = splitMcpTool(options.servers, tool);
    if (parts === undefined) return false;
    const info = pi?.getAllTools().find((entry) => entry.name === tool);
    if (info?.annotations?.readOnlyHint === true) return true;
    return parts.server.allowedTools.some((pattern) => matchesToolPattern(pattern, parts.name));
  };

  const register: ExtensionFactory = (api: ExtensionAPI): void => {
    pi = api;
    for (const server of options.servers) {
      api.registerMcpServer(server.name, {
        type: "http",
        url: server.url,
        headers: server.headers,
        timeout: server.timeoutSec,
        exposure: options.codemode ? "codemode" : "direct",
        ...(server.description === undefined ? {} : { description: server.description }),
      });
    }
    api.on("tool_call", (event) => {
      if (!event.toolName.startsWith(MCP_TOOL_PREFIX) || allows(event.toolName)) return undefined;
      const reason = `the MCP tool "${event.toolName}" is not marked read-only by its server and is not allowed by the administrator`;
      options.onBlocked(event.toolName, reason, event.input);
      return { block: true, reason };
    });
  };

  // Servers come from the JobSpec only: the built-in extension gets an empty configuration, so no mcp.json is read.
  const connect = createMcpExtension({ loadConfig: () => ({ servers: [], errors: [] }) });
  return { factories: [register, connect], allows };
}
