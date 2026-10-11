// Application layer: use cases of CostEntries. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "#common/application/crud.service.js";
import type { CreateCostEntry, CostEntry } from "../domain/cost-entry.js";
import { CostEntryRepository } from "../domain/cost-entry.repository.js";

export type UpdateCostEntry = Partial<CreateCostEntry>;

@Injectable()
export class CostEntriesService extends CrudService<CostEntry, CreateCostEntry> {
  constructor(items: CostEntryRepository) {
    super(items, "CostEntry");
  }
}
