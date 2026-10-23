import { Controller, Delete, Get, HttpCode, Param } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { CodingAgentOAuthService } from "../application/coding-agent-oauth.service.js";

@ApiTags("auth · Coding Agent Workflow connections")
@Controller("auth/member-connections")
export class MemberConnectionsController {
  constructor(private readonly oauth: CodingAgentOAuthService) {}

  @Get()
  @ApiOperation({ summary: "List the current member's Coding Agent Workflow connection metadata" })
  @ApiOkResponse({ description: "Safe connection metadata without access or refresh credentials." })
  async list(@CurrentActor() actor: Actor) {
    return { items: await this.oauth.listOwn(actor) };
  }

  @Delete(":connectionId")
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke one of the current member's Coding Agent Workflow connections" })
  @ApiNoContentResponse({ description: "The connection and its access and refresh credentials are revoked." })
  async revoke(@Param("connectionId") connectionId: string, @CurrentActor() actor: Actor): Promise<void> {
    await this.oauth.revokeOwn(connectionId, actor);
  }
}
