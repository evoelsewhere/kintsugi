// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { DashboardStat } from "../domain/dashboard-stat.js";
import { DashboardStatsService } from "../application/dashboard-stats.service.js";

@ApiTags("monitoring · delivery dashboard")
@Controller("monitoring/dashboards")
export class DashboardStatsController {
  constructor(private readonly dashboardStats: DashboardStatsService) {}

  @Get()
  @ApiOperation({ summary: "List dashboard stats" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<DashboardStat[]> {
    return this.dashboardStats.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one dashboard stat" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<DashboardStat> {
    return this.dashboardStats.get(id);
  }
}
