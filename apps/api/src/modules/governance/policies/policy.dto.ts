import { z } from "zod";

// DTOs for Policies. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createPolicySchema = z.object({
  name: z.string().min(1).max(200),
  scope: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;

export const updatePolicySchema = createPolicySchema.partial();
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;

/** Entity shape returned by the API. */
export interface Policy {
  id: string;
  name: string;
  scope: string;
  status?: string;
}
