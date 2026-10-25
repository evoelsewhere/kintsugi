import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentActor, RequirePermission, type Actor } from "#common/auth/decorators.js";
import { pageQuerySchema } from "#common/interface/pagination.js";
import type { PageQuery } from "#common/application/pagination.js";
import { ProjectMemoryService } from "../application/project-memory.service.js";

const settingSchema = z.object({ enabled: z.boolean() }).strict();
const reviewSchema = z.object({ state: z.enum(["approved", "rejected"]) }).strict();

@ApiTags("admin · project memory")
@Controller("admin/projects/:projectId/memory")
@RequirePermission("project.memory.manage")
export class ProjectMemoryController {
  constructor(private readonly memory: ProjectMemoryService) {}

  @Get()
  @ApiOperation({ summary: "Inspect project memory settings, notes and recovery records" })
  view(@Param("projectId") projectId: string, @Query({ schema: pageQuerySchema }) query: PageQuery, @CurrentActor() actor: Actor) {
    return this.memory.view(projectId, query.offset, query.limit, actor);
  }

  @Put()
  @HttpCode(204)
  @ApiOperation({ summary: "Enable or disable live project memory" })
  configure(@Param("projectId") projectId: string, @Body({ schema: settingSchema }) input: z.infer<typeof settingSchema>, @CurrentActor() actor: Actor) {
    return this.memory.configure(projectId, input.enabled, actor);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: "Reset project memory, recoveries and run scratchpads" })
  reset(@Param("projectId") projectId: string, @CurrentActor() actor: Actor) {
    return this.memory.reset(projectId, actor);
  }

  @Post(":id/forget")
  @HttpCode(200)
  @ApiOperation({ summary: "Forget a memory entry with recovery" })
  forget(@Param("projectId") projectId: string, @Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.memory.forget(projectId,id,actor);
  }

  @Post("recoveries/:recoveryId/restore")
  @HttpCode(200)
  @ApiOperation({ summary: "Restore forgotten project memory" })
  restore(@Param("projectId") projectId: string, @Param("recoveryId") recoveryId: string, @CurrentActor() actor: Actor) {
    return this.memory.restore(projectId,recoveryId,actor);
  }

  @Patch(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Mark memory reviewed or reject it" })
  review(@Param("projectId") projectId: string, @Param("id") id: string, @Body({ schema: reviewSchema }) input: z.infer<typeof reviewSchema>, @CurrentActor() actor: Actor) {
    return this.memory.review(projectId, id, input.state, actor);
  }
}
