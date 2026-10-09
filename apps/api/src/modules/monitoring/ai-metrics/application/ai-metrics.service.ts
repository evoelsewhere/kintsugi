// Application layer: use cases of AiMetrics. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "../../../../common/application/crud.service.js";
import type { CreateAiMetric, AiMetric } from "../domain/ai-metric.js";
import { AiMetricRepository } from "../domain/ai-metric.repository.js";

export type UpdateAiMetric = Partial<CreateAiMetric>;

@Injectable()
export class AiMetricsService extends CrudService<AiMetric, CreateAiMetric> {
  constructor(items: AiMetricRepository) {
    super(items, "AiMetric");
  }
}
