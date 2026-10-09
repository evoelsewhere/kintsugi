// Wiring of the health-checks module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { HealthChecksService } from "./application/health-checks.service.js";
import { HealthCheckRepository } from "./domain/health-check.repository.js";
import { InMemoryHealthCheckRepository } from "./infrastructure/in-memory-health-check.repository.js";
import { HealthChecksController } from "./interface/health-checks.controller.js";

/** monitoring · target system health — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [HealthChecksController],
  providers: [HealthChecksService, { provide: HealthCheckRepository, useClass: InMemoryHealthCheckRepository }],
  exports: [HealthChecksService, HealthCheckRepository],
})
export class HealthChecksModule {}
