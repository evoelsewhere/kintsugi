// Application layer: use cases of ArchitectureViews. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "#common/application/crud.service.js";
import type { CreateArchitectureView, ArchitectureView } from "../domain/architecture-view.js";
import { ArchitectureViewRepository } from "../domain/architecture-view.repository.js";

export type UpdateArchitectureView = Partial<CreateArchitectureView>;

@Injectable()
export class ArchitectureViewsService extends CrudService<ArchitectureView, CreateArchitectureView> {
  constructor(items: ArchitectureViewRepository) {
    super(items, "ArchitectureView");
  }
}
