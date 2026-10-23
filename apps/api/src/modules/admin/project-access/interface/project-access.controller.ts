// Interface layer for Project Access management. Only cookie/session permissions reach these routes.

import { Controller, Delete, Get, HttpCode, Param, Put } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { ProjectAccessService } from "../application/project-access.service.js";

@ApiTags("admin · Project Access")
@Controller("admin/project-access")
@RequirePermission("project.access.manage")
export class ProjectAccessController {
  constructor(private readonly access: ProjectAccessService) {}

  @Get(":projectId")
  @ApiOperation({ summary: "List explicit Project Access grants for one project" })
  @ApiOkResponse({ description: "The users granted access to this project." })
  async list(@Param("projectId") projectId: string, @CurrentActor() actor: Actor) {
    return { items: await this.access.list(projectId, actor) };
  }

  @Put(":projectId/:userId")
  @HttpCode(204)
  @ApiOperation({ summary: "Grant a user explicit access to one project" })
  @ApiNoContentResponse({ description: "The grant is present." })
  async grant(@Param("projectId") projectId: string, @Param("userId") userId: string, @CurrentActor() actor: Actor): Promise<void> {
    await this.access.grant(projectId, userId, actor);
  }

  @Delete(":projectId/:userId")
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke a user's explicit access to one project" })
  @ApiNoContentResponse({ description: "The grant is removed." })
  async revoke(@Param("projectId") projectId: string, @Param("userId") userId: string, @CurrentActor() actor: Actor): Promise<void> {
    await this.access.revoke(projectId, userId, actor);
  }
}
