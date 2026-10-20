// Interface layer for the current user's Coding Agent Workflow tokens.

import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { MemberTokenService } from "../application/member-token.service.js";

const issueTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  projectIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
type IssueTokenBody = z.infer<typeof issueTokenSchema>;

@ApiTags("auth · Coding Agent Workflow tokens")
@Controller("auth/member-tokens")
@RequirePermission("tokens.manage-own")
export class MemberTokensController {
  constructor(private readonly tokens: MemberTokenService) {}

  @Get()
  @ApiOperation({ summary: "List the current user's Coding Agent Workflow tokens without secrets" })
  @ApiOkResponse({ description: "Safe token metadata; raw token values are never returned." })
  async list(@CurrentActor() actor: Actor) {
    return { items: await this.tokens.listOwn(actor) };
  }

  @Post()
  @ApiOperation({ summary: "Issue a personal, project-scoped read token" })
  @ApiCreatedResponse({ description: "The raw token is returned once with safe metadata." })
  issue(@Body({ schema: issueTokenSchema }) input: IssueTokenBody, @CurrentActor() actor: Actor) {
    return this.tokens.issue(actor, { ...input, expiresAt: new Date(input.expiresAt) });
  }

  @Delete(":tokenId")
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke one of the current user's tokens" })
  @ApiNoContentResponse({ description: "The token is revoked." })
  async revoke(@Param("tokenId") tokenId: string, @CurrentActor() actor: Actor): Promise<void> {
    await this.tokens.revoke(actor.id, tokenId, actor);
  }
}
