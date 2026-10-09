import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { LlmProvidersService } from "./llm-providers.service.js";
import {
  type CreateLlmProviderInput,
  createLlmProviderSchema,
  type UpdateLlmProviderInput,
  updateLlmProviderSchema,
  type LlmProvider,
} from "./llm-provider.dto.js";

@ApiTags("admin · LLM providers")
@Controller("admin/llm-providers")
export class LlmProvidersController {
  constructor(private readonly llmProviders: LlmProvidersService) {}

  @Get()
  @ApiOperation({ summary: "List llm providers" })
  @ApiOkResponse({ description: "The matching llm-provider records." })
  list(): Promise<LlmProvider[]> {
    return this.llmProviders.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one llm-provider" })
  @ApiOkResponse({ description: "The llm-provider." })
  get(@Param("id") id: string): Promise<LlmProvider> {
    return this.llmProviders.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a llm-provider" })
  @ApiCreatedResponse({ description: "The created llm-provider." })
  create(@Body({ schema: createLlmProviderSchema }) input: CreateLlmProviderInput): Promise<LlmProvider> {
    return this.llmProviders.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a llm-provider" })
  @ApiOkResponse({ description: "The updated llm-provider." })
  update(@Param("id") id: string, @Body({ schema: updateLlmProviderSchema }) input: UpdateLlmProviderInput): Promise<LlmProvider> {
    return this.llmProviders.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a llm-provider" })
  @ApiNoContentResponse({ description: "The llm-provider is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.llmProviders.remove(id);
  }
}
