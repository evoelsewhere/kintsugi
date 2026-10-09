// Port of Incidents — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateIncident, Incident } from "./incident.js";

export abstract class IncidentRepository extends Repository<Incident, CreateIncident> {}
