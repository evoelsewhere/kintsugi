// Application layer: use cases of VerificationRuns. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "#common/application/crud.service.js";
import type { CreateVerificationRun, VerificationRun } from "../domain/verification-run.js";
import { VerificationRunRepository } from "../domain/verification-run.repository.js";

export type UpdateVerificationRun = Partial<CreateVerificationRun>;

@Injectable()
export class VerificationRunsService extends CrudService<VerificationRun, CreateVerificationRun> {
  constructor(items: VerificationRunRepository) {
    super(items, "VerificationRun");
  }
}
