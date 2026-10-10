// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../../../common/auth/decorators.js";
import type { RulebookEntry } from "../domain/rulebook-entry.js";
import { RulebookEntriesService } from "../application/rulebook-entries.service.js";
import {
  type CreateRulebookEntryInput,
  createRulebookEntrySchema,
  type UpdateRulebookEntryInput,
  updateRulebookEntrySchema,
  toCreateCommand,
  toUpdateCommand,
} from "./rulebook-entry.dto.js";

@ApiTags("governance · rulebook & asset governance")
@Controller("governance/rulebook")
export class RulebookEntriesController {
  constructor(private readonly rulebookEntries: RulebookEntriesService) {}

  @Get()
  @ApiOperation({ summary: "List rulebook entries" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<RulebookEntry[]> {
    return this.rulebookEntries.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one rulebook entry" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<RulebookEntry> {
    return this.rulebookEntries.get(id);
  }

  @RequirePermission("governance.manage")
  @Post()
  @ApiOperation({ summary: "Create a rulebook entry" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createRulebookEntrySchema }) input: CreateRulebookEntryInput): Promise<RulebookEntry> {
    return this.rulebookEntries.create(toCreateCommand(input));
  }

  @RequirePermission("governance.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a rulebook entry" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateRulebookEntrySchema }) input: UpdateRulebookEntryInput): Promise<RulebookEntry> {
    return this.rulebookEntries.update(id, toUpdateCommand(input));
  }

  @RequirePermission("governance.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a rulebook entry" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.rulebookEntries.remove(id);
  }
}
