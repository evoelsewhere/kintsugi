// Interface layer: thin HTTP adapter for projects, applications and their repositories —
// validates input, maps DTOs to application commands, delegates to the use cases.
// Reads need a session; every write needs projects.manage.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page, PageQuery } from "#common/application/pagination.js";
import { RequirePermission } from "#common/auth/decorators.js";
import { pageQuerySchema } from "#common/interface/pagination.js";
import { ProjectsService } from "../application/projects.service.js";
import type { ApplicationRecord, ProjectDetail, ProjectRecord, RenderedManifest } from "../domain/project.js";
import {
  type CreateApplicationInput,
  type CreateProjectInput,
  createApplicationSchema,
  createProjectSchema,
  type LinkRepositoryInput,
  linkRepositorySchema,
  toCreateApplication,
  toCreateProject,
  toLinkRepository,
  toUpdateApplication,
  toUpdateProject,
  type UpdateApplicationInput,
  type UpdateProjectInput,
  updateApplicationSchema,
  updateProjectSchema,
} from "./project.dto.js";

@ApiTags("admin · projects & applications")
@Controller("admin/projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: "List projects" })
  @ApiOkResponse({ description: "Projects with their document repository id." })
  list(@Query({ schema: pageQuerySchema }) query: PageQuery): Promise<Page<ProjectRecord>> {
    return this.projects.listProjects(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a project with its applications and repositories, grouped AS-IS / TO-BE" })
  @ApiOkResponse({ description: "The project; each application lists asIs {legacy, legacyData} and toBe {document, targets}." })
  get(@Param("id") id: string): Promise<ProjectDetail> {
    return this.projects.getProject(id);
  }

  @Get(":id/kintsugi.yaml")
  @ApiOperation({ summary: "Render the project's kintsugi.yaml (publish it with POST :id/kintsugi.yaml/publish)" })
  @ApiOkResponse({ description: "{ fileName, content } with the YAML text." })
  manifest(@Param("id") id: string): Promise<RenderedManifest> {
    return this.projects.renderManifest(id);
  }

  @RequirePermission("projects.manage")
  @Post()
  @ApiOperation({ summary: "Create a project with its document repository" })
  @ApiCreatedResponse({ description: "The created project." })
  create(@Body({ schema: createProjectSchema }) input: CreateProjectInput): Promise<ProjectRecord> {
    return this.projects.createProject(toCreateProject(input));
  }

  @RequirePermission("projects.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a project: name, description, document repository" })
  @ApiOkResponse({ description: "The updated project." })
  update(@Param("id") id: string, @Body({ schema: updateProjectSchema }) input: UpdateProjectInput): Promise<ProjectRecord> {
    return this.projects.updateProject(id, toUpdateProject(input));
  }

  @RequirePermission("projects.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a project with its applications (the repositories stay registered)" })
  @ApiNoContentResponse({ description: "The project is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.projects.removeProject(id);
  }

  @Get(":id/applications/:applicationId")
  @ApiOperation({ summary: "Get one application" })
  @ApiOkResponse({ description: "The application." })
  getApplication(@Param("id") id: string, @Param("applicationId") applicationId: string): Promise<ApplicationRecord> {
    return this.projects.getApplication(id, applicationId);
  }

  @RequirePermission("projects.manage")
  @Post(":id/applications")
  @ApiOperation({ summary: "Add an application to a project" })
  @ApiCreatedResponse({ description: "The created application." })
  createApplication(@Param("id") id: string, @Body({ schema: createApplicationSchema }) input: CreateApplicationInput): Promise<ApplicationRecord> {
    return this.projects.createApplication(id, toCreateApplication(input));
  }

  @RequirePermission("projects.manage")
  @Patch(":id/applications/:applicationId")
  @ApiOperation({ summary: "Update an application: name, disposition, pipeline" })
  @ApiOkResponse({ description: "The updated application." })
  updateApplication(
    @Param("id") id: string,
    @Param("applicationId") applicationId: string,
    @Body({ schema: updateApplicationSchema }) input: UpdateApplicationInput,
  ): Promise<ApplicationRecord> {
    return this.projects.updateApplication(id, applicationId, toUpdateApplication(input));
  }

  @RequirePermission("projects.manage")
  @Delete(":id/applications/:applicationId")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove an application and unlink its repositories" })
  @ApiNoContentResponse({ description: "The application is removed." })
  async removeApplication(@Param("id") id: string, @Param("applicationId") applicationId: string): Promise<void> {
    await this.projects.removeApplication(id, applicationId);
  }

  @RequirePermission("projects.manage")
  @Post(":id/applications/:applicationId/repositories")
  @ApiOperation({ summary: "Link a registered repository to an application: legacy, legacy-data, or target with its component" })
  @ApiCreatedResponse({ description: "The project with its grouped repositories." })
  link(
    @Param("id") id: string,
    @Param("applicationId") applicationId: string,
    @Body({ schema: linkRepositorySchema }) input: LinkRepositoryInput,
  ): Promise<ProjectDetail> {
    return this.projects.linkRepository(id, applicationId, toLinkRepository(input));
  }

  @RequirePermission("projects.manage")
  @Delete(":id/applications/:applicationId/repositories/:repositoryId")
  @HttpCode(204)
  @ApiOperation({ summary: "Unlink a repository from an application (it stays registered)" })
  @ApiNoContentResponse({ description: "The link is removed." })
  async unlink(@Param("id") id: string, @Param("applicationId") applicationId: string, @Param("repositoryId") repositoryId: string): Promise<void> {
    await this.projects.unlinkRepository(id, applicationId, repositoryId);
  }
}
