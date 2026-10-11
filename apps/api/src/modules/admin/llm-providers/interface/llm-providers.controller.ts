// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AgentModelBinding } from "@kintsugi/runtime-sdk";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import type { Page, PageQuery } from "#common/application/pagination.js";
import { pageQuerySchema } from "#common/interface/pagination.js";
import type { SupportedProviders } from "../domain/provider-catalog.js";
import { LlmProvidersService, type LlmProviderView, type TestConnectionResult } from "../application/llm-providers.service.js";
import {
  type AgentModelBindingInput,
  type CreateProviderInput,
  createProviderSchema,
  replaceBindingsSchema,
  replaceProviderSchema,
  type ReplaceProviderInput,
  toCreateCommand,
  toReplaceCommand,
} from "./llm-provider.dto.js";

/** Settings → Providers in the portal: the LLM provider registry (ADR-0009). */
@ApiTags("admin · LLM providers")
@Controller("admin/llm-providers")
@RequirePermission("providers.manage")
export class LlmProvidersController {
  constructor(private readonly providers: LlmProvidersService) {}

  @Get()
  @ApiOperation({ summary: "List configured LLM providers (credentials redacted)" })
  @ApiOkResponse({ description: "A page of configured providers." })
  list(@Query({ schema: pageQuerySchema }) query: PageQuery): Promise<Page<LlmProviderView>> {
    return this.providers.listPage(query);
  }

  @Get("model-bindings")
  @ApiOperation({ summary: "List agent → provider/model bindings" })
  @ApiOkResponse({ description: "The agent model bindings." })
  listBindings(): Promise<AgentModelBinding[]> {
    return this.providers.listBindings();
  }

  @Get("supported")
  @ApiOperation({ summary: "Supported providers and models (read from the pinned pi catalog)" })
  @ApiOkResponse({ description: "Builtin providers with their models and the custom wire protocols." })
  supported(): SupportedProviders {
    return this.providers.supported();
  }

  @Put("model-bindings")
  @ApiOperation({ summary: "Replace all agent → provider/model bindings" })
  @ApiOkResponse({ description: "The stored bindings." })
  replaceBindings(@Body({ schema: replaceBindingsSchema }) bindings: AgentModelBindingInput[], @CurrentActor() actor: Actor): Promise<AgentModelBinding[]> {
    return this.providers.replaceBindings(bindings, actor);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one LLM provider (credential redacted)" })
  @ApiOkResponse({ description: "The provider." })
  get(@Param("id") id: string): Promise<LlmProviderView> {
    return this.providers.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Register an LLM provider" })
  @ApiCreatedResponse({ description: "The created provider; the credential is stored encrypted." })
  create(@Body({ schema: createProviderSchema }) input: CreateProviderInput, @CurrentActor() actor: Actor): Promise<LlmProviderView> {
    return this.providers.create(toCreateCommand(input), actor);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Replace an LLM provider configuration" })
  @ApiOkResponse({ description: "The updated provider." })
  replace(@Param("id") id: string, @Body({ schema: replaceProviderSchema }) input: ReplaceProviderInput, @CurrentActor() actor: Actor): Promise<LlmProviderView> {
    return this.providers.replace(id, toReplaceCommand(id, input), actor);
  }

  @Post(":id/test")
  @ApiOperation({ summary: "Test the stored credential against the provider endpoint" })
  @ApiOkResponse({ description: "The connectivity check result." })
  test(@Param("id") id: string): Promise<TestConnectionResult> {
    return this.providers.testConnection(id);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove an LLM provider" })
  @ApiNoContentResponse({ description: "The provider is removed." })
  async remove(@Param("id") id: string, @CurrentActor() actor: Actor): Promise<void> {
    await this.providers.remove(id, actor);
  }
}
