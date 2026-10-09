// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Project } from "../domain/project.js";
import { ProjectsService } from "../application/projects.service.js";
import {
  type CreateProjectInput,
  createProjectSchema,
  type UpdateProjectInput,
  updateProjectSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./project.dto.js";

@ApiTags("admin · projects & applications")
@Controller("admin/projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: "List projects" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<Project[]> {
    return this.projects.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one project" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<Project> {
    return this.projects.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a project" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createProjectSchema }) input: CreateProjectInput): Promise<Project> {
    return this.projects.create(toCreateCommand(input));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a project" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateProjectSchema }) input: UpdateProjectInput): Promise<Project> {
    return this.projects.update(id, toUpdateCommand(input));
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a project" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.projects.remove(id);
  }
}
