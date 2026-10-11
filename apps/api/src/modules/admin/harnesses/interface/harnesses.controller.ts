// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "#common/auth/decorators.js";
import type { Harness } from "../domain/harness.js";
import { HarnessesService } from "../application/harnesses.service.js";
import {
  type CreateHarnessInput,
  createHarnessSchema,
  type UpdateHarnessInput,
  updateHarnessSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./harness.dto.js";

@ApiTags("admin · harness registry")
@Controller("admin/harnesses")
export class HarnessesController {
  constructor(private readonly harnesses: HarnessesService) {}

  @Get()
  @ApiOperation({ summary: "List harnesses" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<Harness[]> {
    return this.harnesses.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one harness" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<Harness> {
    return this.harnesses.get(id);
  }

  @RequirePermission("setup.manage")
  @Post()
  @ApiOperation({ summary: "Create a harness" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createHarnessSchema }) input: CreateHarnessInput): Promise<Harness> {
    return this.harnesses.create(toCreateCommand(input));
  }

  @RequirePermission("setup.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a harness" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateHarnessSchema }) input: UpdateHarnessInput): Promise<Harness> {
    return this.harnesses.update(id, toUpdateCommand(input));
  }

  @RequirePermission("setup.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a harness" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.harnesses.remove(id);
  }
}
