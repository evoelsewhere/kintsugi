import { Module } from "@nestjs/common";
import { LlmProvidersController } from "./llm-providers.controller.js";
import { LlmProvidersService } from "./llm-providers.service.js";

/** admin · LLM providers — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [LlmProvidersController], providers: [LlmProvidersService], exports: [LlmProvidersService] })
export class LlmProvidersModule {}
