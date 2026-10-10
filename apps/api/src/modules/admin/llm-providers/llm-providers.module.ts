// Wiring of the LLM provider registry module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { LlmProvidersService } from "./application/llm-providers.service.js";
import { LlmProviderRepository } from "./domain/llm-provider.repository.js";
import { ProviderCatalog } from "./domain/provider-catalog.js";
import { PgLlmProviderRepository } from "./infrastructure/pg-llm-provider.repository.js";
import { RuntimeProviderCatalog } from "./infrastructure/runtime-provider-catalog.js";
import { LlmProvidersController } from "./interface/llm-providers.controller.js";

/** admin · LLM providers — docs/architecture/05-building-block-view.md (A4). */
@Module({
  controllers: [LlmProvidersController],
  providers: [
    LlmProvidersService,
    { provide: LlmProviderRepository, useClass: PgLlmProviderRepository },
    { provide: ProviderCatalog, useClass: RuntimeProviderCatalog },
  ],
  exports: [LlmProvidersService, LlmProviderRepository],
})
export class LlmProvidersModule {}
