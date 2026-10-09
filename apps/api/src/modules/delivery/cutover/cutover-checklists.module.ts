// Wiring of the cutover-checklists module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { CutoverChecklistsService } from "./application/cutover-checklists.service.js";
import { CutoverChecklistRepository } from "./domain/cutover-checklist.repository.js";
import { InMemoryCutoverChecklistRepository } from "./infrastructure/in-memory-cutover-checklist.repository.js";
import { CutoverChecklistsController } from "./interface/cutover-checklists.controller.js";

/** delivery · cutover — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [CutoverChecklistsController],
  providers: [CutoverChecklistsService, { provide: CutoverChecklistRepository, useClass: InMemoryCutoverChecklistRepository }],
  exports: [CutoverChecklistsService, CutoverChecklistRepository],
})
export class CutoverChecklistsModule {}
