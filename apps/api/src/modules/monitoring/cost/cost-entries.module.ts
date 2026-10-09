import { Module } from "@nestjs/common";
import { CostEntriesController } from "./cost-entries.controller.js";
import { CostEntriesService } from "./cost-entries.service.js";

/** monitoring · cost & FinOps — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [CostEntriesController], providers: [CostEntriesService], exports: [CostEntriesService] })
export class CostEntriesModule {}
