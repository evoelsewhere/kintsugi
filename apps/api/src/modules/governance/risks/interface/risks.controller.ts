// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "#common/auth/decorators.js";
import type { Risk } from "../domain/risk.js";
import { RisksService } from "../application/risks.service.js";
import {
  type CreateRiskInput,
  createRiskSchema,
  type UpdateRiskInput,
  updateRiskSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./risk.dto.js";

@ApiTags("governance · risk & change")
@Controller("governance/risks")
export class RisksController {
  constructor(private readonly risks: RisksService) {}

  @Get()
  @ApiOperation({ summary: "List risks" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<Risk[]> {
    return this.risks.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one risk" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<Risk> {
    return this.risks.get(id);
  }

  @RequirePermission("governance.manage")
  @Post()
  @ApiOperation({ summary: "Create a risk" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createRiskSchema }) input: CreateRiskInput): Promise<Risk> {
    return this.risks.create(toCreateCommand(input));
  }

  @RequirePermission("governance.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a risk" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateRiskSchema }) input: UpdateRiskInput): Promise<Risk> {
    return this.risks.update(id, toUpdateCommand(input));
  }

  @RequirePermission("governance.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a risk" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.risks.remove(id);
  }
}
