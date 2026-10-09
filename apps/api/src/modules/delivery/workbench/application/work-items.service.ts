// Application layer: use cases of WorkItems. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "../../../../common/application/crud.service.js";
import type { CreateWorkItem, WorkItem } from "../domain/work-item.js";
import { WorkItemRepository } from "../domain/work-item.repository.js";

export type UpdateWorkItem = Partial<CreateWorkItem>;

@Injectable()
export class WorkItemsService extends CrudService<WorkItem, CreateWorkItem> {
  constructor(items: WorkItemRepository) {
    super(items, "WorkItem");
  }
}
