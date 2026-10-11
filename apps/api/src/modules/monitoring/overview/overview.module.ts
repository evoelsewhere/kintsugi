// Wiring of the monitoring overview module: the use case plus the Postgres read model and the
// pg-boss queue health bound to the domain ports.

import { Module } from "@nestjs/common";
import { OverviewService } from "./application/overview.service.js";
import { MonitoringReadModel, QueueHealth } from "./domain/overview.ports.js";
import { PgBossQueueHealth } from "./infrastructure/pg-boss-queue.health.js";
import { PgMonitoringReadModel } from "./infrastructure/pg-monitoring.read-model.js";
import { OverviewController } from "./interface/overview.controller.js";

/** monitoring · overview: read-only aggregates over runs, writes, repositories and the worker's queues. */
@Module({
  controllers: [OverviewController],
  providers: [OverviewService, { provide: MonitoringReadModel, useClass: PgMonitoringReadModel }, { provide: QueueHealth, useClass: PgBossQueueHealth }],
  exports: [OverviewService],
})
export class OverviewModule {}
