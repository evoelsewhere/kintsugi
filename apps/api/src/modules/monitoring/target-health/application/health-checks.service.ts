// Application layer: use cases of HealthChecks. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "#common/application/crud.service.js";
import type { CreateHealthCheck, HealthCheck } from "../domain/health-check.js";
import { HealthCheckRepository } from "../domain/health-check.repository.js";

export type UpdateHealthCheck = Partial<CreateHealthCheck>;

@Injectable()
export class HealthChecksService extends CrudService<HealthCheck, CreateHealthCheck> {
  constructor(items: HealthCheckRepository) {
    super(items, "HealthCheck");
  }
}
