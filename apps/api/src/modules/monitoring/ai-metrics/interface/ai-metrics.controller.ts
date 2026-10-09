// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AiMetric } from "../domain/ai-metric.js";
import { AiMetricsService } from "../application/ai-metrics.service.js";

@ApiTags("monitoring · AI metrics")
@Controller("monitoring/ai-metrics")
export class AiMetricsController {
  constructor(private readonly aiMetrics: AiMetricsService) {}

  @Get()
  @ApiOperation({ summary: "List ai metrics" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<AiMetric[]> {
    return this.aiMetrics.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one ai metric" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<AiMetric> {
    return this.aiMetrics.get(id);
  }
}
