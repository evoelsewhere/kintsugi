// Interface layer for plugin access management. Only cookie/session permissions reach these routes.

import { Controller, Delete, Get, HttpCode, Param, Put } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { PluginAccessService } from "../application/plugin-access.service.js";

@ApiTags("admin · plugin access")
@Controller("admin/plugin-access")
@RequirePermission("plugin.access.manage")
export class PluginAccessController {
  constructor(private readonly access: PluginAccessService) {}

  @Get(":projectId")
  @ApiOperation({ summary: "List the member plugin grants of one project" })
  @ApiOkResponse({ description: "The grants; userId * covers every member with Project Access." })
  async list(@Param("projectId") projectId: string, @CurrentActor() actor: Actor) {
    return { items: await this.access.list(projectId, actor) };
  }

  @Put(":projectId/:pluginName/:userId")
  @HttpCode(204)
  @ApiOperation({ summary: "Let a user (or * for every member) use a member plugin in a project" })
  @ApiNoContentResponse({ description: "The grant is present." })
  async grant(@Param("projectId") projectId: string, @Param("pluginName") pluginName: string, @Param("userId") userId: string, @CurrentActor() actor: Actor): Promise<void> {
    await this.access.grant(projectId, pluginName, userId, actor);
  }

  @Delete(":projectId/:pluginName/:userId")
  @HttpCode(204)
  @ApiOperation({ summary: "Withdraw a member plugin grant" })
  @ApiNoContentResponse({ description: "The grant is removed." })
  async revoke(@Param("projectId") projectId: string, @Param("pluginName") pluginName: string, @Param("userId") userId: string, @CurrentActor() actor: Actor): Promise<void> {
    await this.access.revoke(projectId, pluginName, userId, actor);
  }
}
