import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RisksService } from "./risks.service.js";
import {
  type CreateRiskInput,
  createRiskSchema,
  type UpdateRiskInput,
  updateRiskSchema,
  type Risk,
} from "./risk.dto.js";

@ApiTags("governance · risk & change")
@Controller("governance/risks")
export class RisksController {
  constructor(private readonly risks: RisksService) {}

  @Get()
  @ApiOperation({ summary: "List risks" })
  @ApiOkResponse({ description: "The matching risk records." })
  list(): Promise<Risk[]> {
    return this.risks.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one risk" })
  @ApiOkResponse({ description: "The risk." })
  get(@Param("id") id: string): Promise<Risk> {
    return this.risks.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a risk" })
  @ApiCreatedResponse({ description: "The created risk." })
  create(@Body({ schema: createRiskSchema }) input: CreateRiskInput): Promise<Risk> {
    return this.risks.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a risk" })
  @ApiOkResponse({ description: "The updated risk." })
  update(@Param("id") id: string, @Body({ schema: updateRiskSchema }) input: UpdateRiskInput): Promise<Risk> {
    return this.risks.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a risk" })
  @ApiNoContentResponse({ description: "The risk is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.risks.remove(id);
  }
}
