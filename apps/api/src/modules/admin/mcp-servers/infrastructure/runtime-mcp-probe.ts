// Adapter of the MCP probe port over the runtime's MCP client. The pi-specific part lives in
// services/runtime (`@kintsugi/runtime/mcp-probe`); this adapter only maps it onto the domain port.

import { Injectable } from "@nestjs/common";
import { probeMcpServer } from "@kintsugi/runtime/mcp-probe";
import { McpProbe, type McpProbeResult } from "../domain/mcp-server.ports.js";

@Injectable()
export class RuntimeMcpProbe extends McpProbe {
  probe(options: { url: string; headers: Record<string, string>; timeoutSec: number }): Promise<McpProbeResult> {
    return probeMcpServer(options);
  }
}
