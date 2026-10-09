import { z } from "zod";

// DTOs for CutoverChecklists. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createCutoverChecklistSchema = z.object({
  application: z.string().min(1).max(200),
  decision: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateCutoverChecklistInput = z.infer<typeof createCutoverChecklistSchema>;

export const updateCutoverChecklistSchema = createCutoverChecklistSchema.partial();
export type UpdateCutoverChecklistInput = z.infer<typeof updateCutoverChecklistSchema>;

/** Entity shape returned by the API. */
export interface CutoverChecklist {
  id: string;
  application: string;
  decision: string;
  status?: string;
}
