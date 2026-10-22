// Interface layer: Settings → MCP servers (ADR-0047). Thin HTTP adapter over the use cases.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { type McpServerChoice, McpServersService, type McpServerView, type McpTestResult } from "../application/mcp-servers.service.js";
import { type CreateMcpServerInput, createMcpServerSchema, type ReplaceMcpServerInput, replaceMcpServerSchema, toCommand } from "./mcp-server.dto.js";

@ApiTags("admin · MCP servers")
@Controller("admin/mcp-servers")
@RequirePermission("mcp.manage")
export class McpServersController {
  constructor(private readonly servers: McpServersService) {}

  @Get()
  @ApiOperation({ summary: "List the registered MCP servers (header values never returned)" })
  @ApiOkResponse({ description: "The servers, ordered by id." })
  list(): Promise<McpServerView[]> {
    return this.servers.list();
  }

  // Agent builders choose from the registered servers without being able to see where they are.
  @Get("choices")
  @RequirePermission("mcp.manage", "agents.manage")
  @ApiOperation({ summary: "The registered servers an agent can name in its tools: id, description and the tools entry (no address, no headers)" })
  @ApiOkResponse({ description: "The servers, ordered by id." })
  choices(): Promise<McpServerChoice[]> {
    return this.servers.choices();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one MCP server (header values never returned)" })
  @ApiOkResponse({ description: "The server." })
  get(@Param("id") id: string): Promise<McpServerView> {
    return this.servers.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Register an MCP server" })
  @ApiCreatedResponse({ description: "The created server; its header values are stored encrypted." })
  create(@Body({ schema: createMcpServerSchema }) input: CreateMcpServerInput, @CurrentActor() actor: Actor): Promise<McpServerView> {
    const { id, ...rest } = input;
    return this.servers.create(toCommand(id, rest, undefined), actor);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Replace an MCP server's settings; a header value of null keeps the stored one" })
  @ApiOkResponse({ description: "The updated server." })
  replace(@Param("id") id: string, @Body({ schema: replaceMcpServerSchema }) input: ReplaceMcpServerInput, @CurrentActor() actor: Actor): Promise<McpServerView> {
    return this.servers.replace(id, toCommand(id, input, undefined), actor);
  }

  @Post(":id/test")
  @HttpCode(200)
  @ApiOperation({ summary: "Connect to the server with its stored headers and list its tools and which of them agents can use" })
  @ApiOkResponse({ description: "The connection result; a failure is ok: false, not an error." })
  test(@Param("id") id: string): Promise<McpTestResult> {
    return this.servers.test(id);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove an MCP server" })
  @ApiNoContentResponse({ description: "The server is removed." })
  async remove(@Param("id") id: string, @CurrentActor() actor: Actor): Promise<void> {
    await this.servers.remove(id, actor);
  }
}
