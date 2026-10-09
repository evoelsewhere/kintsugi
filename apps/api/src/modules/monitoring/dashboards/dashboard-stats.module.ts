// Wiring of the dashboard-stats module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { DashboardStatsService } from "./application/dashboard-stats.service.js";
import { DashboardStatRepository } from "./domain/dashboard-stat.repository.js";
import { InMemoryDashboardStatRepository } from "./infrastructure/in-memory-dashboard-stat.repository.js";
import { DashboardStatsController } from "./interface/dashboard-stats.controller.js";

/** monitoring · delivery dashboard — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [DashboardStatsController],
  providers: [DashboardStatsService, { provide: DashboardStatRepository, useClass: InMemoryDashboardStatRepository }],
  exports: [DashboardStatsService, DashboardStatRepository],
})
export class DashboardStatsModule {}
