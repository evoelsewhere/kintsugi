import { z } from "zod";

// DTOs for Gates. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createGateSchema = z.object({
  gate: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateGateInput = z.infer<typeof createGateSchema>;

export const updateGateSchema = createGateSchema.partial();
export type UpdateGateInput = z.infer<typeof updateGateSchema>;

/** Entity shape returned by the API. */
export interface Gate {
  id: string;
  gate: string;
  status?: string;
}
