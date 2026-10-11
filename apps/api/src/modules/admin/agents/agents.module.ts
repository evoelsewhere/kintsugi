// Wiring of the Agent Builder module: the use cases plus the Postgres repository and the
// packaged built-in catalog bound to the domain ports. Model bindings come from the LLM
// provider registry.

import { Module } from "@nestjs/common";
import { LlmProvidersModule } from "#modules/admin/llm-providers/index.js";
import { AgentsService } from "./application/agents.service.js";
import { AgentCatalog, AgentRepository } from "./domain/agent.repository.js";
import { PackagedAgentCatalog } from "./infrastructure/packaged-agent.catalog.js";
import { PgAgentRepository } from "./infrastructure/pg-agent.repository.js";
import { AgentSkillsController, AgentsController } from "./interface/agents.controller.js";

/** admin · agents (A4, ADR-0026): built-in and custom agents, shared skills. */
@Module({
  imports: [LlmProvidersModule],
  controllers: [AgentsController, AgentSkillsController],
  providers: [AgentsService, { provide: AgentRepository, useClass: PgAgentRepository }, { provide: AgentCatalog, useClass: PackagedAgentCatalog }],
  exports: [AgentsService],
})
export class AgentsModule {}
