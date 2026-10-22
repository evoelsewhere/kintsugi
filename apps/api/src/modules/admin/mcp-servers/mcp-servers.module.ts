// Wiring of the MCP server registry module: interface + application + the infrastructure adapters
// bound to the domain ports.

import { Module } from "@nestjs/common";
import { McpServersService } from "./application/mcp-servers.service.js";
import { McpProbe, McpServerRepository } from "./domain/mcp-server.ports.js";
import { PgMcpServerRepository } from "./infrastructure/pg-mcp-server.repository.js";
import { RuntimeMcpProbe } from "./infrastructure/runtime-mcp-probe.js";
import { McpServersController } from "./interface/mcp-servers.controller.js";

/** admin · MCP servers: the HTTP MCP servers the runtime may give to agents (ADR-0047). */
@Module({
  controllers: [McpServersController],
  providers: [McpServersService, { provide: McpServerRepository, useClass: PgMcpServerRepository }, { provide: McpProbe, useClass: RuntimeMcpProbe }],
  exports: [McpServersService],
})
export class McpServersModule {}
