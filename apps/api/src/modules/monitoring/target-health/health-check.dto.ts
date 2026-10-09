import { z } from "zod";

// DTOs for HealthChecks. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createHealthCheckSchema = z.object({
  application: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateHealthCheckInput = z.infer<typeof createHealthCheckSchema>;

export const updateHealthCheckSchema = createHealthCheckSchema.partial();
export type UpdateHealthCheckInput = z.infer<typeof updateHealthCheckSchema>;

/** Entity shape returned by the API. */
export interface HealthCheck {
  id: string;
  application: string;
  status?: string;
}
