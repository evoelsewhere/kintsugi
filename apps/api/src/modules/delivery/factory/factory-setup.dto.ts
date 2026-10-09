import { z } from "zod";

// DTOs for FactorySetups. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createFactorySetupSchema = z.object({
  application: z.string().min(1).max(200),
  stage: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateFactorySetupInput = z.infer<typeof createFactorySetupSchema>;

export const updateFactorySetupSchema = createFactorySetupSchema.partial();
export type UpdateFactorySetupInput = z.infer<typeof updateFactorySetupSchema>;

/** Entity shape returned by the API. */
export interface FactorySetup {
  id: string;
  application: string;
  stage: string;
  status?: string;
}
