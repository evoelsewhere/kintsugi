import { z } from "zod";

// DTOs for Templates. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = createTemplateSchema.partial();
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

/** Entity shape returned by the API. */
export interface Template {
  id: string;
  name: string;
  kind: string;
  status?: string;
}
