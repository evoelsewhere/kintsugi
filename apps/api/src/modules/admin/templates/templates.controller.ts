import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { TemplatesService } from "./templates.service.js";
import {
  type CreateTemplateInput,
  createTemplateSchema,
  type UpdateTemplateInput,
  updateTemplateSchema,
  type Template,
} from "./template.dto.js";

@ApiTags("admin · templates")
@Controller("admin/templates")
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @ApiOperation({ summary: "List templates" })
  @ApiOkResponse({ description: "The matching template records." })
  list(): Promise<Template[]> {
    return this.templates.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one template" })
  @ApiOkResponse({ description: "The template." })
  get(@Param("id") id: string): Promise<Template> {
    return this.templates.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a template" })
  @ApiCreatedResponse({ description: "The created template." })
  create(@Body({ schema: createTemplateSchema }) input: CreateTemplateInput): Promise<Template> {
    return this.templates.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a template" })
  @ApiOkResponse({ description: "The updated template." })
  update(@Param("id") id: string, @Body({ schema: updateTemplateSchema }) input: UpdateTemplateInput): Promise<Template> {
    return this.templates.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a template" })
  @ApiNoContentResponse({ description: "The template is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.templates.remove(id);
  }
}
