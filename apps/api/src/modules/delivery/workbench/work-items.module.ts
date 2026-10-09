// Wiring of the work-items module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { WorkItemsService } from "./application/work-items.service.js";
import { WorkItemRepository } from "./domain/work-item.repository.js";
import { InMemoryWorkItemRepository } from "./infrastructure/in-memory-work-item.repository.js";
import { WorkItemsController } from "./interface/work-items.controller.js";

/** delivery · migration workbench — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [WorkItemsController],
  providers: [WorkItemsService, { provide: WorkItemRepository, useClass: InMemoryWorkItemRepository }],
  exports: [WorkItemsService, WorkItemRepository],
})
export class WorkItemsModule {}
