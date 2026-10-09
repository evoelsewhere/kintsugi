// Wiring of the factory-setups module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { FactorySetupsService } from "./application/factory-setups.service.js";
import { FactorySetupRepository } from "./domain/factory-setup.repository.js";
import { InMemoryFactorySetupRepository } from "./infrastructure/in-memory-factory-setup.repository.js";
import { FactorySetupsController } from "./interface/factory-setups.controller.js";

/** delivery · factory setup — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [FactorySetupsController],
  providers: [FactorySetupsService, { provide: FactorySetupRepository, useClass: InMemoryFactorySetupRepository }],
  exports: [FactorySetupsService, FactorySetupRepository],
})
export class FactorySetupsModule {}
