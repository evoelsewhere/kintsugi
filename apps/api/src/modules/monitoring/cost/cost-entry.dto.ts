import { z } from "zod";

// DTOs for CostEntries. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createCostEntrySchema = z.object({
  model: z.string().min(1).max(200),
  costUsd: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateCostEntryInput = z.infer<typeof createCostEntrySchema>;

export const updateCostEntrySchema = createCostEntrySchema.partial();
export type UpdateCostEntryInput = z.infer<typeof updateCostEntrySchema>;

/** Entity shape returned by the API. */
export interface CostEntry {
  id: string;
  model: string;
  costUsd: string;
  status?: string;
}
