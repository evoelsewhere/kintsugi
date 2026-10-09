import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { WorkItemsService } from "./work-items.service.js";
import {
  type CreateWorkItemInput,
  createWorkItemSchema,
  type UpdateWorkItemInput,
  updateWorkItemSchema,
  type WorkItem,
} from "./work-item.dto.js";

@ApiTags("delivery · migration workbench")
@Controller("delivery/workbench")
export class WorkItemsController {
  constructor(private readonly workItems: WorkItemsService) {}

  @Get()
  @ApiOperation({ summary: "List work items" })
  @ApiOkResponse({ description: "The matching work-item records." })
  list(): Promise<WorkItem[]> {
    return this.workItems.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one work-item" })
  @ApiOkResponse({ description: "The work-item." })
  get(@Param("id") id: string): Promise<WorkItem> {
    return this.workItems.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a work-item" })
  @ApiCreatedResponse({ description: "The created work-item." })
  create(@Body({ schema: createWorkItemSchema }) input: CreateWorkItemInput): Promise<WorkItem> {
    return this.workItems.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a work-item" })
  @ApiOkResponse({ description: "The updated work-item." })
  update(@Param("id") id: string, @Body({ schema: updateWorkItemSchema }) input: UpdateWorkItemInput): Promise<WorkItem> {
    return this.workItems.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a work-item" })
  @ApiNoContentResponse({ description: "The work-item is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.workItems.remove(id);
  }
}
