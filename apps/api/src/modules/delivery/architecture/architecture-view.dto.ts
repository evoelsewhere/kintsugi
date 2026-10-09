import { z } from "zod";

// DTOs for ArchitectureViews. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createArchitectureViewSchema = z.object({
  application: z.string().min(1).max(200),
  kind: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateArchitectureViewInput = z.infer<typeof createArchitectureViewSchema>;

export const updateArchitectureViewSchema = createArchitectureViewSchema.partial();
export type UpdateArchitectureViewInput = z.infer<typeof updateArchitectureViewSchema>;

/** Entity shape returned by the API. */
export interface ArchitectureView {
  id: string;
  application: string;
  kind: string;
  status?: string;
}
