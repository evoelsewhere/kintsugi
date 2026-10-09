// Wiring of the architecture-views module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { ArchitectureViewsService } from "./application/architecture-views.service.js";
import { ArchitectureViewRepository } from "./domain/architecture-view.repository.js";
import { InMemoryArchitectureViewRepository } from "./infrastructure/in-memory-architecture-view.repository.js";
import { ArchitectureViewsController } from "./interface/architecture-views.controller.js";

/** delivery · architecture studio — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [ArchitectureViewsController],
  providers: [ArchitectureViewsService, { provide: ArchitectureViewRepository, useClass: InMemoryArchitectureViewRepository }],
  exports: [ArchitectureViewsService, ArchitectureViewRepository],
})
export class ArchitectureViewsModule {}
