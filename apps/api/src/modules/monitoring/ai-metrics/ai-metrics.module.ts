// Wiring of the ai-metrics module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { AiMetricsService } from "./application/ai-metrics.service.js";
import { AiMetricRepository } from "./domain/ai-metric.repository.js";
import { InMemoryAiMetricRepository } from "./infrastructure/in-memory-ai-metric.repository.js";
import { AiMetricsController } from "./interface/ai-metrics.controller.js";

/** monitoring · AI metrics — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [AiMetricsController],
  providers: [AiMetricsService, { provide: AiMetricRepository, useClass: InMemoryAiMetricRepository }],
  exports: [AiMetricsService, AiMetricRepository],
})
export class AiMetricsModule {}
