// Application layer: use cases of Risks. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "../../../../common/application/crud.service.js";
import type { CreateRisk, Risk } from "../domain/risk.js";
import { RiskRepository } from "../domain/risk.repository.js";

export type UpdateRisk = Partial<CreateRisk>;

@Injectable()
export class RisksService extends CrudService<Risk, CreateRisk> {
  constructor(items: RiskRepository) {
    super(items, "Risk");
  }
}
