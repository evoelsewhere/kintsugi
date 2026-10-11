// Application layer: use cases of Incidents. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "#common/application/crud.service.js";
import type { CreateIncident, Incident } from "../domain/incident.js";
import { IncidentRepository } from "../domain/incident.repository.js";

export type UpdateIncident = Partial<CreateIncident>;

@Injectable()
export class IncidentsService extends CrudService<Incident, CreateIncident> {
  constructor(items: IncidentRepository) {
    super(items, "Incident");
  }
}
