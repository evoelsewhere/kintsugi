// Wiring of the cost-entries module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { CostEntriesService } from "./application/cost-entries.service.js";
import { CostEntryRepository } from "./domain/cost-entry.repository.js";
import { InMemoryCostEntryRepository } from "./infrastructure/in-memory-cost-entry.repository.js";
import { CostEntriesController } from "./interface/cost-entries.controller.js";

/** monitoring · cost & FinOps — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [CostEntriesController],
  providers: [CostEntriesService, { provide: CostEntryRepository, useClass: InMemoryCostEntryRepository }],
  exports: [CostEntriesService, CostEntryRepository],
})
export class CostEntriesModule {}
