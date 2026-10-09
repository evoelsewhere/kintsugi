import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { DashboardStatsService } from "./dashboard-stats.service.js";
import type { DashboardStat } from "./dashboard-stat.dto.js";

@ApiTags("monitoring · delivery dashboard")
@Controller("monitoring/dashboards")
export class DashboardStatsController {
  constructor(private readonly dashboardStats: DashboardStatsService) {}

  @Get()
  @ApiOperation({ summary: "List dashboard stats" })
  @ApiOkResponse({ description: "The matching dashboard-stat records." })
  list(): Promise<DashboardStat[]> {
    return this.dashboardStats.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one dashboard-stat" })
  @ApiOkResponse({ description: "The dashboard-stat." })
  get(@Param("id") id: string): Promise<DashboardStat> {
    return this.dashboardStats.get(id);
  }
}
