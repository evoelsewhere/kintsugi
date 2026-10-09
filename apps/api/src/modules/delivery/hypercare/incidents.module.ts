// Wiring of the incidents module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { IncidentsService } from "./application/incidents.service.js";
import { IncidentRepository } from "./domain/incident.repository.js";
import { InMemoryIncidentRepository } from "./infrastructure/in-memory-incident.repository.js";
import { IncidentsController } from "./interface/incidents.controller.js";

/** delivery · hypercare & operate — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [IncidentsController],
  providers: [IncidentsService, { provide: IncidentRepository, useClass: InMemoryIncidentRepository }],
  exports: [IncidentsService, IncidentRepository],
})
export class IncidentsModule {}
