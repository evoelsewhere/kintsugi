// Wiring of the verification-runs module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { VerificationRunsService } from "./application/verification-runs.service.js";
import { VerificationRunRepository } from "./domain/verification-run.repository.js";
import { InMemoryVerificationRunRepository } from "./infrastructure/in-memory-verification-run.repository.js";
import { VerificationRunsController } from "./interface/verification-runs.controller.js";

/** delivery · verification — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [VerificationRunsController],
  providers: [VerificationRunsService, { provide: VerificationRunRepository, useClass: InMemoryVerificationRunRepository }],
  exports: [VerificationRunsService, VerificationRunRepository],
})
export class VerificationRunsModule {}
