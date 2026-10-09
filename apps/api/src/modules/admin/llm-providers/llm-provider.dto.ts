import { z } from "zod";

// DTOs for LlmProviders. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createLlmProviderSchema = z.object({
  name: z.string().min(1).max(200),
  provider: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateLlmProviderInput = z.infer<typeof createLlmProviderSchema>;

export const updateLlmProviderSchema = createLlmProviderSchema.partial();
export type UpdateLlmProviderInput = z.infer<typeof updateLlmProviderSchema>;

/** Entity shape returned by the API. */
export interface LlmProvider {
  id: string;
  name: string;
  provider: string;
  status?: string;
}
