import { z } from "zod";

// DTOs for VerificationRuns. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createVerificationRunSchema = z.object({
  application: z.string().min(1).max(200),
  profile: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateVerificationRunInput = z.infer<typeof createVerificationRunSchema>;

export const updateVerificationRunSchema = createVerificationRunSchema.partial();
export type UpdateVerificationRunInput = z.infer<typeof updateVerificationRunSchema>;

/** Entity shape returned by the API. */
export interface VerificationRun {
  id: string;
  application: string;
  profile: string;
  status?: string;
}
