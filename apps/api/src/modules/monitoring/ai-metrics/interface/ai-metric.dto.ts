// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdateAiMetric } from "../application/ai-metrics.service.js";
import type { CreateAiMetric } from "../domain/ai-metric.js";

export const createAiMetricSchema = z.object({
  metric: stringField(false),
  value: stringField(false),
  status: stringField(true),
});
export type CreateAiMetricInput = z.infer<typeof createAiMetricSchema>;

export const updateAiMetricSchema = createAiMetricSchema.partial();
export type UpdateAiMetricInput = z.infer<typeof updateAiMetricSchema>;

export function toCreateCommand(input: CreateAiMetricInput): CreateAiMetric {
  return { ...input };
}

export function toUpdateCommand(input: UpdateAiMetricInput): UpdateAiMetric {
  return { ...input };
}
