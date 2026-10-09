import { z } from "zod";

// DTOs for Reviews. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createReviewSchema = z.object({
  subject: z.string().min(1).max(200),
  decision: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const updateReviewSchema = createReviewSchema.partial();
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;

/** Entity shape returned by the API. */
export interface Review {
  id: string;
  subject: string;
  decision: string;
  status?: string;
}
