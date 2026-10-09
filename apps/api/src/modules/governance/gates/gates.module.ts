// Wiring of the gates module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { GatesService } from "./application/gates.service.js";
import { GateRepository } from "./domain/gate.repository.js";
import { InMemoryGateRepository } from "./infrastructure/in-memory-gate.repository.js";
import { GatesController } from "./interface/gates.controller.js";

/** governance · quality gates — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [GatesController],
  providers: [GatesService, { provide: GateRepository, useClass: InMemoryGateRepository }],
  exports: [GatesService, GateRepository],
})
export class GatesModule {}
