// Wiring of the item catalog module (ADR-0033): the catalog read from the document repo and the
// item status derived from understand runs. Documents and runs come from their modules.

import { Module } from "@nestjs/common";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { RuntimeJobsModule } from "#modules/delivery/runtime-jobs/index.js";
import { CatalogService } from "./application/catalog.service.js";
import { CatalogController } from "./interface/catalog.controller.js";

/** delivery · item catalog (ADR-0033). */
@Module({
  imports: [DocumentsModule, RuntimeJobsModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
