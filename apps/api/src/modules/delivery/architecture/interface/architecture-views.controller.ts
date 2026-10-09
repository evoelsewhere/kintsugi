// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ArchitectureView } from "../domain/architecture-view.js";
import { ArchitectureViewsService } from "../application/architecture-views.service.js";
import {
  type CreateArchitectureViewInput,
  createArchitectureViewSchema,
  type UpdateArchitectureViewInput,
  updateArchitectureViewSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./architecture-view.dto.js";

@ApiTags("delivery · architecture studio")
@Controller("delivery/architecture")
export class ArchitectureViewsController {
  constructor(private readonly architectureViews: ArchitectureViewsService) {}

  @Get()
  @ApiOperation({ summary: "List architecture views" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<ArchitectureView[]> {
    return this.architectureViews.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one architecture view" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<ArchitectureView> {
    return this.architectureViews.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a architecture view" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createArchitectureViewSchema }) input: CreateArchitectureViewInput): Promise<ArchitectureView> {
    return this.architectureViews.create(toCreateCommand(input));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a architecture view" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateArchitectureViewSchema }) input: UpdateArchitectureViewInput): Promise<ArchitectureView> {
    return this.architectureViews.update(id, toUpdateCommand(input));
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a architecture view" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.architectureViews.remove(id);
  }
}
