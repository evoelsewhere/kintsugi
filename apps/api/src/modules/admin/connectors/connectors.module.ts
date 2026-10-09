// Wiring of the connectors module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { ConnectorsService } from "./application/connectors.service.js";
import { ConnectorRepository } from "./domain/connector.repository.js";
import { InMemoryConnectorRepository } from "./infrastructure/in-memory-connector.repository.js";
import { ConnectorsController } from "./interface/connectors.controller.js";

/** admin · connectors — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [ConnectorsController],
  providers: [ConnectorsService, { provide: ConnectorRepository, useClass: InMemoryConnectorRepository }],
  exports: [ConnectorsService, ConnectorRepository],
})
export class ConnectorsModule {}
