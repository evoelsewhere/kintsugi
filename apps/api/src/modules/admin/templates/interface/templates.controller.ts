// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "#common/auth/decorators.js";
import type { Template } from "../domain/template.js";
import { TemplatesService } from "../application/templates.service.js";
import {
  type CreateTemplateInput,
  createTemplateSchema,
  type UpdateTemplateInput,
  updateTemplateSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./template.dto.js";

@ApiTags("admin · templates")
@Controller("admin/templates")
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @ApiOperation({ summary: "List templates" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<Template[]> {
    return this.templates.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one template" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<Template> {
    return this.templates.get(id);
  }

  @RequirePermission("projects.manage")
  @Post()
  @ApiOperation({ summary: "Create a template" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createTemplateSchema }) input: CreateTemplateInput): Promise<Template> {
    return this.templates.create(toCreateCommand(input));
  }

  @RequirePermission("projects.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a template" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateTemplateSchema }) input: UpdateTemplateInput): Promise<Template> {
    return this.templates.update(id, toUpdateCommand(input));
  }

  @RequirePermission("projects.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a template" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.templates.remove(id);
  }
}
