import { z } from "zod";

// DTOs for PortfolioItems. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createPortfolioItemSchema = z.object({
  unit: z.string().min(1).max(200),
  disposition: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreatePortfolioItemInput = z.infer<typeof createPortfolioItemSchema>;

export const updatePortfolioItemSchema = createPortfolioItemSchema.partial();
export type UpdatePortfolioItemInput = z.infer<typeof updatePortfolioItemSchema>;

/** Entity shape returned by the API. */
export interface PortfolioItem {
  id: string;
  unit: string;
  disposition: string;
  status?: string;
}
