import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ProjectBuildsService } from "./project-builds.service.js";
import {
  type CreateProjectBuildInput,
  createProjectBuildSchema,
  type UpdateProjectBuildInput,
  updateProjectBuildSchema,
  type ProjectBuild,
} from "./project-build.dto.js";

@ApiTags("admin · project build")
@Controller("admin/project-build")
export class ProjectBuildsController {
  constructor(private readonly projectBuilds: ProjectBuildsService) {}

  @Get()
  @ApiOperation({ summary: "List project builds" })
  @ApiOkResponse({ description: "The matching project-build records." })
  list(): Promise<ProjectBuild[]> {
    return this.projectBuilds.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one project-build" })
  @ApiOkResponse({ description: "The project-build." })
  get(@Param("id") id: string): Promise<ProjectBuild> {
    return this.projectBuilds.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a project-build" })
  @ApiCreatedResponse({ description: "The created project-build." })
  create(@Body({ schema: createProjectBuildSchema }) input: CreateProjectBuildInput): Promise<ProjectBuild> {
    return this.projectBuilds.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a project-build" })
  @ApiOkResponse({ description: "The updated project-build." })
  update(@Param("id") id: string, @Body({ schema: updateProjectBuildSchema }) input: UpdateProjectBuildInput): Promise<ProjectBuild> {
    return this.projectBuilds.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a project-build" })
  @ApiNoContentResponse({ description: "The project-build is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.projectBuilds.remove(id);
  }
}
