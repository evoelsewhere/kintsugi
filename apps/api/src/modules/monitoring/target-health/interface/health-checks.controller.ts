// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { HealthCheck } from "../domain/health-check.js";
import { HealthChecksService } from "../application/health-checks.service.js";

@ApiTags("monitoring · target system health")
@Controller("monitoring/target-health")
export class HealthChecksController {
  constructor(private readonly healthChecks: HealthChecksService) {}

  @Get()
  @ApiOperation({ summary: "List health checks" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<HealthCheck[]> {
    return this.healthChecks.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one health check" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<HealthCheck> {
    return this.healthChecks.get(id);
  }
}
