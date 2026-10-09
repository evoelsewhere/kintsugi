import { Module } from "@nestjs/common";
import { DashboardStatsController } from "./dashboard-stats.controller.js";
import { DashboardStatsService } from "./dashboard-stats.service.js";

/** monitoring · delivery dashboard — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [DashboardStatsController], providers: [DashboardStatsService], exports: [DashboardStatsService] })
export class DashboardStatsModule {}
