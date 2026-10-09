import { z } from "zod";

// DTOs for DashboardStats. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createDashboardStatSchema = z.object({
  metric: z.string().min(1).max(200),
  value: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateDashboardStatInput = z.infer<typeof createDashboardStatSchema>;

export const updateDashboardStatSchema = createDashboardStatSchema.partial();
export type UpdateDashboardStatInput = z.infer<typeof updateDashboardStatSchema>;

/** Entity shape returned by the API. */
export interface DashboardStat {
  id: string;
  metric: string;
  value: string;
  status?: string;
}
