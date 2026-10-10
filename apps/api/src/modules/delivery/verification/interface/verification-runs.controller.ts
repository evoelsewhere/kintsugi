// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../../../common/auth/decorators.js";
import type { VerificationRun } from "../domain/verification-run.js";
import { VerificationRunsService } from "../application/verification-runs.service.js";
import {
  type CreateVerificationRunInput,
  createVerificationRunSchema,
  type UpdateVerificationRunInput,
  updateVerificationRunSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./verification-run.dto.js";

@ApiTags("delivery · verification")
@Controller("delivery/verification")
export class VerificationRunsController {
  constructor(private readonly verificationRuns: VerificationRunsService) {}

  @Get()
  @ApiOperation({ summary: "List verification runs" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<VerificationRun[]> {
    return this.verificationRuns.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one verification run" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<VerificationRun> {
    return this.verificationRuns.get(id);
  }

  @RequirePermission("workitems.manage")
  @Post()
  @ApiOperation({ summary: "Create a verification run" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createVerificationRunSchema }) input: CreateVerificationRunInput): Promise<VerificationRun> {
    return this.verificationRuns.create(toCreateCommand(input));
  }

  @RequirePermission("workitems.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a verification run" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateVerificationRunSchema }) input: UpdateVerificationRunInput): Promise<VerificationRun> {
    return this.verificationRuns.update(id, toUpdateCommand(input));
  }

  @RequirePermission("workitems.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a verification run" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.verificationRuns.remove(id);
  }
}
