// Application layer: use cases of Gates. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "../../../../common/application/crud.service.js";
import type { CreateGate, Gate } from "../domain/gate.js";
import { GateRepository } from "../domain/gate.repository.js";

export type UpdateGate = Partial<CreateGate>;

@Injectable()
export class GatesService extends CrudService<Gate, CreateGate> {
  constructor(items: GateRepository) {
    super(items, "Gate");
  }
}
