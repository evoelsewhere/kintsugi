// Port of AiMetrics — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateAiMetric, AiMetric } from "./ai-metric.js";

export abstract class AiMetricRepository extends Repository<AiMetric, CreateAiMetric> {}
