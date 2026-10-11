// Application layer: use cases of CutoverChecklists. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "#common/application/crud.service.js";
import type { CreateCutoverChecklist, CutoverChecklist } from "../domain/cutover-checklist.js";
import { CutoverChecklistRepository } from "../domain/cutover-checklist.repository.js";

export type UpdateCutoverChecklist = Partial<CreateCutoverChecklist>;

@Injectable()
export class CutoverChecklistsService extends CrudService<CutoverChecklist, CreateCutoverChecklist> {
  constructor(items: CutoverChecklistRepository) {
    super(items, "CutoverChecklist");
  }
}
