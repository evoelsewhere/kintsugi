import { Module } from "@nestjs/common";
import { HealthChecksController } from "./health-checks.controller.js";
import { HealthChecksService } from "./health-checks.service.js";

/** monitoring · target system health — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [HealthChecksController], providers: [HealthChecksService], exports: [HealthChecksService] })
export class HealthChecksModule {}
