import { Module } from "@nestjs/common";
import { AiMetricsController } from "./ai-metrics.controller.js";
import { AiMetricsService } from "./ai-metrics.service.js";

/** monitoring · AI metrics — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [AiMetricsController], providers: [AiMetricsService], exports: [AiMetricsService] })
export class AiMetricsModule {}
