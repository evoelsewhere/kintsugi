import { z } from "zod";

// DTOs for AiMetrics. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createAiMetricSchema = z.object({
  metric: z.string().min(1).max(200),
  value: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateAiMetricInput = z.infer<typeof createAiMetricSchema>;

export const updateAiMetricSchema = createAiMetricSchema.partial();
export type UpdateAiMetricInput = z.infer<typeof updateAiMetricSchema>;

/** Entity shape returned by the API. */
export interface AiMetric {
  id: string;
  metric: string;
  value: string;
  status?: string;
}
