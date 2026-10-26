// Wiring of the design module (ADR-0044, ADR-0045): the design sets and the conformance of each
// unit's design documents, read from the document repo. Documents come from their module.

import { Module } from "@nestjs/common";
import { CatalogModule } from "#modules/delivery/catalog/index.js";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { RuntimeJobsModule } from "#modules/delivery/runtime-jobs/index.js";
import { DesignRunsService } from "./application/design-runs.service.js";
import { DesignService } from "./application/design.service.js";
import { DesignController } from "./interface/design.controller.js";

/** delivery · design sets, unit designs and the runs that generate them (ADR-0049). */
@Module({
  imports: [DocumentsModule, RuntimeJobsModule, CatalogModule],
  controllers: [DesignController],
  providers: [DesignService, DesignRunsService],
  exports: [DesignService],
})
export class DesignModule {}
