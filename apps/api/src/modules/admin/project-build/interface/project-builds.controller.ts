// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../../../common/auth/decorators.js";
import type { ProjectBuild } from "../domain/project-build.js";
import { ProjectBuildsService } from "../application/project-builds.service.js";
import {
  type CreateProjectBuildInput,
  createProjectBuildSchema,
  type UpdateProjectBuildInput,
  updateProjectBuildSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./project-build.dto.js";

@ApiTags("admin · project build")
@Controller("admin/project-build")
export class ProjectBuildsController {
  constructor(private readonly projectBuilds: ProjectBuildsService) {}

  @Get()
  @ApiOperation({ summary: "List project builds" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<ProjectBuild[]> {
    return this.projectBuilds.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one project build" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<ProjectBuild> {
    return this.projectBuilds.get(id);
  }

  @RequirePermission("projects.manage")
  @Post()
  @ApiOperation({ summary: "Create a project build" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createProjectBuildSchema }) input: CreateProjectBuildInput): Promise<ProjectBuild> {
    return this.projectBuilds.create(toCreateCommand(input));
  }

  @RequirePermission("projects.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a project build" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateProjectBuildSchema }) input: UpdateProjectBuildInput): Promise<ProjectBuild> {
    return this.projectBuilds.update(id, toUpdateCommand(input));
  }

  @RequirePermission("projects.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a project build" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.projectBuilds.remove(id);
  }
}
