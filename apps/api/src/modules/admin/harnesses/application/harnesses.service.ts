// Application layer: use cases of Harnesses. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "#common/application/crud.service.js";
import type { CreateHarness, Harness } from "../domain/harness.js";
import { HarnessRepository } from "../domain/harness.repository.js";

export type UpdateHarness = Partial<CreateHarness>;

@Injectable()
export class HarnessesService extends CrudService<Harness, CreateHarness> {
  constructor(items: HarnessRepository) {
    super(items, "Harness");
  }
}
