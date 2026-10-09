import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { VerificationRunsService } from "./verification-runs.service.js";
import {
  type CreateVerificationRunInput,
  createVerificationRunSchema,
  type UpdateVerificationRunInput,
  updateVerificationRunSchema,
  type VerificationRun,
} from "./verification-run.dto.js";

@ApiTags("delivery · verification")
@Controller("delivery/verification")
export class VerificationRunsController {
  constructor(private readonly verificationRuns: VerificationRunsService) {}

  @Get()
  @ApiOperation({ summary: "List verification runs" })
  @ApiOkResponse({ description: "The matching verification-run records." })
  list(): Promise<VerificationRun[]> {
    return this.verificationRuns.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one verification-run" })
  @ApiOkResponse({ description: "The verification-run." })
  get(@Param("id") id: string): Promise<VerificationRun> {
    return this.verificationRuns.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a verification-run" })
  @ApiCreatedResponse({ description: "The created verification-run." })
  create(@Body({ schema: createVerificationRunSchema }) input: CreateVerificationRunInput): Promise<VerificationRun> {
    return this.verificationRuns.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a verification-run" })
  @ApiOkResponse({ description: "The updated verification-run." })
  update(@Param("id") id: string, @Body({ schema: updateVerificationRunSchema }) input: UpdateVerificationRunInput): Promise<VerificationRun> {
    return this.verificationRuns.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a verification-run" })
  @ApiNoContentResponse({ description: "The verification-run is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.verificationRuns.remove(id);
  }
}
