// Application layer: use cases of Policies. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "#common/application/crud.service.js";
import type { CreatePolicy, Policy } from "../domain/policy.js";
import { PolicyRepository } from "../domain/policy.repository.js";

export type UpdatePolicy = Partial<CreatePolicy>;

@Injectable()
export class PoliciesService extends CrudService<Policy, CreatePolicy> {
  constructor(items: PolicyRepository) {
    super(items, "Policy");
  }
}
