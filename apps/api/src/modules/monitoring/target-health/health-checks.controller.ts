import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HealthChecksService } from "./health-checks.service.js";
import type { HealthCheck } from "./health-check.dto.js";

@ApiTags("monitoring · target system health")
@Controller("monitoring/target-health")
export class HealthChecksController {
  constructor(private readonly healthChecks: HealthChecksService) {}

  @Get()
  @ApiOperation({ summary: "List health checks" })
  @ApiOkResponse({ description: "The matching health-check records." })
  list(): Promise<HealthCheck[]> {
    return this.healthChecks.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one health-check" })
  @ApiOkResponse({ description: "The health-check." })
  get(@Param("id") id: string): Promise<HealthCheck> {
    return this.healthChecks.get(id);
  }
}
