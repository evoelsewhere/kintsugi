// Interface layer for the current user's Kintsugi member tokens.

import { Controller, Delete, Get, HttpCode, Param } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { MemberTokenService } from "../application/member-token.service.js";

@ApiTags("auth · member tokens")
@Controller("auth/member-tokens")
@RequirePermission("tokens.manage-own")
export class MemberTokensController {
  constructor(private readonly tokens: MemberTokenService) {}

  @Get()
  @ApiOperation({ summary: "List the current user's Kintsugi member tokens without secrets" })
  @ApiOkResponse({ description: "Safe token metadata; raw token values are never returned." })
  async list(@CurrentActor() actor: Actor) {
    return { items: await this.tokens.listOwn(actor) };
  }

  @Delete(":tokenId")
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke one of the current user's tokens" })
  @ApiNoContentResponse({ description: "The token is revoked." })
  async revoke(@Param("tokenId") tokenId: string, @CurrentActor() actor: Actor): Promise<void> {
    await this.tokens.revoke(actor.id, tokenId, actor);
  }
}
