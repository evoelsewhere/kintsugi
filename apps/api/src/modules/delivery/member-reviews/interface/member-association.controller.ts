import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentActor, RequirePermission, type Actor } from "#common/auth/decorators.js";
import { MemberAssociationService } from "../application/member-association.service.js";
import {
  confirmMemberAssociationSchema,
  mapProviderActorSchema,
  memberAssociationListQuerySchema,
  providerIdentityParamSchema,
  type ConfirmMemberAssociationInput,
  type MapProviderActorInput,
  type MemberAssociationListQuery,
} from "./member-association.dto.js";

@ApiTags("Coding Agent Workflow · pull-request associations")
@Controller("member-associations")
export class MemberAssociationController {
  constructor(private readonly associations: MemberAssociationService) {}

  @Get("needs-confirmation")
  @RequirePermission("workitems.manage")
  @ApiOperation({ summary: "List project pull requests that need a task association" })
  @ApiOkResponse({ description: "Unassociated or unconfirmed pull requests for registered project repositories." })
  needsConfirmation(
    @Query({ schema: memberAssociationListQuerySchema }) query: MemberAssociationListQuery,
    @CurrentActor() actor: Actor,
  ) {
    return this.associations.listNeedsConfirmation(query.projectId, query.limit ?? 50, query.offset ?? 0, actor);
  }

  @Put(":projectId/actors/:serverId/:providerActorId")
  @RequirePermission("project.access.manage")
  @HttpCode(204)
  @ApiOperation({ summary: "Map a stable provider actor ID to an authorized project user" })
  @ApiNoContentResponse({ description: "The immutable provider actor mapping is present." })
  async mapActor(
    @Param("projectId", { schema: providerIdentityParamSchema }) projectId: string,
    @Param("serverId", { schema: providerIdentityParamSchema }) serverId: string,
    @Param("providerActorId", { schema: providerIdentityParamSchema }) providerActorId: string,
    @Body({ schema: mapProviderActorSchema }) body: MapProviderActorInput,
    @CurrentActor() actor: Actor,
  ): Promise<void> {
    await this.associations.mapProviderActor({ projectId, serverId, providerActorId, userId: body.userId }, actor);
  }

  @Post(":serverId/:providerRepositoryId/:providerPullRequestId/confirm")
  @RequirePermission("workitems.manage")
  @ApiOperation({ summary: "Confirm a pull-request association against a pinned task context" })
  async confirm(
    @Param("serverId", { schema: providerIdentityParamSchema }) serverId: string,
    @Param("providerRepositoryId", { schema: providerIdentityParamSchema }) providerRepositoryId: string,
    @Param("providerPullRequestId", { schema: providerIdentityParamSchema }) providerPullRequestId: string,
    @Body({ schema: confirmMemberAssociationSchema }) body: ConfirmMemberAssociationInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.associations.confirm({ serverId, providerRepositoryId, providerPullRequestId, ...body }, actor);
  }
}
