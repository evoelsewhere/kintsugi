// Wiring of the harnesses module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { HarnessesService } from "./application/harnesses.service.js";
import { HarnessRepository } from "./domain/harness.repository.js";
import { InMemoryHarnessRepository } from "./infrastructure/in-memory-harness.repository.js";
import { HarnessesController } from "./interface/harnesses.controller.js";

/** admin · harness registry — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [HarnessesController],
  providers: [HarnessesService, { provide: HarnessRepository, useClass: InMemoryHarnessRepository }],
  exports: [HarnessesService, HarnessRepository],
})
export class HarnessesModule {}
