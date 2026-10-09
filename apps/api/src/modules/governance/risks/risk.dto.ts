import { z } from "zod";

// DTOs for Risks. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createRiskSchema = z.object({
  title: z.string().min(1).max(200),
  severity: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateRiskInput = z.infer<typeof createRiskSchema>;

export const updateRiskSchema = createRiskSchema.partial();
export type UpdateRiskInput = z.infer<typeof updateRiskSchema>;

/** Entity shape returned by the API. */
export interface Risk {
  id: string;
  title: string;
  severity: string;
  status?: string;
}
