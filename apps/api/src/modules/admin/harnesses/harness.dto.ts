import { z } from "zod";

// DTOs for Harnesses. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createHarnessSchema = z.object({
  name: z.string().min(1).max(200),
  support: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateHarnessInput = z.infer<typeof createHarnessSchema>;

export const updateHarnessSchema = createHarnessSchema.partial();
export type UpdateHarnessInput = z.infer<typeof updateHarnessSchema>;

/** Entity shape returned by the API. */
export interface Harness {
  id: string;
  name: string;
  support: string;
  status?: string;
}
