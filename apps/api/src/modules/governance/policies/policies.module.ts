// Wiring of the policies module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { PoliciesService } from "./application/policies.service.js";
import { PolicyRepository } from "./domain/policy.repository.js";
import { InMemoryPolicyRepository } from "./infrastructure/in-memory-policy.repository.js";
import { PoliciesController } from "./interface/policies.controller.js";

/** governance · policy engine — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [PoliciesController],
  providers: [PoliciesService, { provide: PolicyRepository, useClass: InMemoryPolicyRepository }],
  exports: [PoliciesService, PolicyRepository],
})
export class PoliciesModule {}
