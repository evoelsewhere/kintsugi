// Wiring of the risks module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { RisksService } from "./application/risks.service.js";
import { RiskRepository } from "./domain/risk.repository.js";
import { InMemoryRiskRepository } from "./infrastructure/in-memory-risk.repository.js";
import { RisksController } from "./interface/risks.controller.js";

/** governance · risk & change — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [RisksController],
  providers: [RisksService, { provide: RiskRepository, useClass: InMemoryRiskRepository }],
  exports: [RisksService, RiskRepository],
})
export class RisksModule {}
