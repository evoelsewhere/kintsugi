import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HarnessesService } from "./harnesses.service.js";
import {
  type CreateHarnessInput,
  createHarnessSchema,
  type UpdateHarnessInput,
  updateHarnessSchema,
  type Harness,
} from "./harness.dto.js";

@ApiTags("admin · harness registry")
@Controller("admin/harnesses")
export class HarnessesController {
  constructor(private readonly harnesses: HarnessesService) {}

  @Get()
  @ApiOperation({ summary: "List harnesses" })
  @ApiOkResponse({ description: "The matching harness records." })
  list(): Promise<Harness[]> {
    return this.harnesses.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one harness" })
  @ApiOkResponse({ description: "The harness." })
  get(@Param("id") id: string): Promise<Harness> {
    return this.harnesses.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a harness" })
  @ApiCreatedResponse({ description: "The created harness." })
  create(@Body({ schema: createHarnessSchema }) input: CreateHarnessInput): Promise<Harness> {
    return this.harnesses.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a harness" })
  @ApiOkResponse({ description: "The updated harness." })
  update(@Param("id") id: string, @Body({ schema: updateHarnessSchema }) input: UpdateHarnessInput): Promise<Harness> {
    return this.harnesses.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a harness" })
  @ApiNoContentResponse({ description: "The harness is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.harnesses.remove(id);
  }
}
