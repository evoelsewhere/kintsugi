// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "#common/auth/decorators.js";
import type { WorkItem } from "../domain/work-item.js";
import { WorkItemsService } from "../application/work-items.service.js";
import {
  type CreateWorkItemInput,
  createWorkItemSchema,
  type UpdateWorkItemInput,
  updateWorkItemSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./work-item.dto.js";

@ApiTags("delivery · migration workbench")
@Controller("delivery/workbench")
export class WorkItemsController {
  constructor(private readonly workItems: WorkItemsService) {}

  @Get()
  @ApiOperation({ summary: "List work items" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<WorkItem[]> {
    return this.workItems.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one work item" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<WorkItem> {
    return this.workItems.get(id);
  }

  @RequirePermission("workitems.manage")
  @Post()
  @ApiOperation({ summary: "Create a work item" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createWorkItemSchema }) input: CreateWorkItemInput): Promise<WorkItem> {
    return this.workItems.create(toCreateCommand(input));
  }

  @RequirePermission("workitems.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a work item" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateWorkItemSchema }) input: UpdateWorkItemInput): Promise<WorkItem> {
    return this.workItems.update(id, toUpdateCommand(input));
  }

  @RequirePermission("workitems.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a work item" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.workItems.remove(id);
  }
}
