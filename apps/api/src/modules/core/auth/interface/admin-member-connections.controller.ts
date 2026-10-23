import { Controller, Delete, Get, HttpCode, Param } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { CodingAgentOAuthService } from "../application/coding-agent-oauth.service.js";

@ApiTags("admin · Coding Agent Workflow connections")
@Controller("admin/coding-agent-connections")
@RequirePermission("security.manage")
export class AdminMemberConnectionsController {
  constructor(private readonly oauth: CodingAgentOAuthService) {}

  @Get()
  @ApiOperation({ summary: "List all Coding Agent Workflow connection metadata" })
  @ApiOkResponse({ description: "Safe connection metadata without access or refresh credentials." })
  async list() {
    return { items: await this.oauth.listAll() };
  }

  @Delete(":connectionId")
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke any Coding Agent Workflow connection" })
  @ApiNoContentResponse({ description: "The connection and its access and refresh credentials are revoked." })
  async revoke(@Param("connectionId") connectionId: string, @CurrentActor() actor: Actor): Promise<void> {
    await this.oauth.revokeAny(connectionId, actor);
  }
}
