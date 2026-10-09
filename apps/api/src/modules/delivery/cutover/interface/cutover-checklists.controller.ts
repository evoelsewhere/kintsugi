// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { CutoverChecklist } from "../domain/cutover-checklist.js";
import { CutoverChecklistsService } from "../application/cutover-checklists.service.js";
import {
  type CreateCutoverChecklistInput,
  createCutoverChecklistSchema,
  type UpdateCutoverChecklistInput,
  updateCutoverChecklistSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./cutover-checklist.dto.js";

@ApiTags("delivery · cutover")
@Controller("delivery/cutover")
export class CutoverChecklistsController {
  constructor(private readonly cutoverChecklists: CutoverChecklistsService) {}

  @Get()
  @ApiOperation({ summary: "List cutover checklists" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<CutoverChecklist[]> {
    return this.cutoverChecklists.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one cutover checklist" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<CutoverChecklist> {
    return this.cutoverChecklists.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a cutover checklist" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createCutoverChecklistSchema }) input: CreateCutoverChecklistInput): Promise<CutoverChecklist> {
    return this.cutoverChecklists.create(toCreateCommand(input));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a cutover checklist" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateCutoverChecklistSchema }) input: UpdateCutoverChecklistInput): Promise<CutoverChecklist> {
    return this.cutoverChecklists.update(id, toUpdateCommand(input));
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a cutover checklist" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.cutoverChecklists.remove(id);
  }
}
