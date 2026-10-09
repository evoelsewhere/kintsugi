import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RulebookEntriesService } from "./rulebook-entries.service.js";
import {
  type CreateRulebookEntryInput,
  createRulebookEntrySchema,
  type UpdateRulebookEntryInput,
  updateRulebookEntrySchema,
  type RulebookEntry,
} from "./rulebook-entry.dto.js";

@ApiTags("governance · rulebook & asset governance")
@Controller("governance/rulebook")
export class RulebookEntriesController {
  constructor(private readonly rulebookEntries: RulebookEntriesService) {}

  @Get()
  @ApiOperation({ summary: "List rulebook entries" })
  @ApiOkResponse({ description: "The matching rulebook-entry records." })
  list(): Promise<RulebookEntry[]> {
    return this.rulebookEntries.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one rulebook-entry" })
  @ApiOkResponse({ description: "The rulebook-entry." })
  get(@Param("id") id: string): Promise<RulebookEntry> {
    return this.rulebookEntries.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a rulebook-entry" })
  @ApiCreatedResponse({ description: "The created rulebook-entry." })
  create(@Body({ schema: createRulebookEntrySchema }) input: CreateRulebookEntryInput): Promise<RulebookEntry> {
    return this.rulebookEntries.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a rulebook-entry" })
  @ApiOkResponse({ description: "The updated rulebook-entry." })
  update(@Param("id") id: string, @Body({ schema: updateRulebookEntrySchema }) input: UpdateRulebookEntryInput): Promise<RulebookEntry> {
    return this.rulebookEntries.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a rulebook-entry" })
  @ApiNoContentResponse({ description: "The rulebook-entry is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.rulebookEntries.remove(id);
  }
}
