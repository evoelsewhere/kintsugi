// Wiring of the portfolio overview module: a read-only composition over projects, runtime jobs,
// documents, the item catalog, gates and document writes.

import { Module } from "@nestjs/common";
import { DocumentWritesModule } from "#modules/admin/document-writes/index.js";
import { ProjectsModule } from "#modules/admin/projects/index.js";
import { CatalogModule } from "#modules/delivery/catalog/index.js";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { RuntimeJobsModule } from "#modules/delivery/runtime-jobs/index.js";
import { GatesModule } from "#modules/governance/gates/index.js";
import { PortfolioService } from "./application/portfolio.service.js";
import { PortfolioController } from "./interface/portfolio.controller.js";

/** monitoring · portfolio overview: the lifecycle position and the next decisions across applications. */
@Module({
  imports: [ProjectsModule, RuntimeJobsModule, DocumentsModule, CatalogModule, GatesModule, DocumentWritesModule],
  controllers: [PortfolioController],
  providers: [PortfolioService],
})
export class PortfolioOverviewModule {}
