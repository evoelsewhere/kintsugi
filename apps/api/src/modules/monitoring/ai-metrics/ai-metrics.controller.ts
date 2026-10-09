import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AiMetricsService } from "./ai-metrics.service.js";
import type { AiMetric } from "./ai-metric.dto.js";

@ApiTags("monitoring · AI metrics")
@Controller("monitoring/ai-metrics")
export class AiMetricsController {
  constructor(private readonly aiMetrics: AiMetricsService) {}

  @Get()
  @ApiOperation({ summary: "List ai metrics" })
  @ApiOkResponse({ description: "The matching ai-metric records." })
  list(): Promise<AiMetric[]> {
    return this.aiMetrics.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one ai-metric" })
  @ApiOkResponse({ description: "The ai-metric." })
  get(@Param("id") id: string): Promise<AiMetric> {
    return this.aiMetrics.get(id);
  }
}
