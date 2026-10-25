import { Module } from "@nestjs/common";
import { AgentsModule } from "#modules/admin/agents/index.js";
import { WebSearchService } from "./application/web-search.service.js";
import { WebSearchRepository } from "./domain/web-search.repository.js";
import { PgWebSearchRepository } from "./infrastructure/pg-web-search.repository.js";
import { WebSearchController } from "./interface/web-search.controller.js";
@Module({ imports: [AgentsModule], controllers: [WebSearchController], providers: [WebSearchService, { provide: WebSearchRepository, useClass: PgWebSearchRepository }] })
export class WebSearchModule {}
