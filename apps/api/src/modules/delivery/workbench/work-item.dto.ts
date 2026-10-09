import { z } from "zod";

// DTOs for WorkItems. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createWorkItemSchema = z.object({
  unit: z.string().min(1).max(200),
  stage: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>;

export const updateWorkItemSchema = createWorkItemSchema.partial();
export type UpdateWorkItemInput = z.infer<typeof updateWorkItemSchema>;

/** Entity shape returned by the API. */
export interface WorkItem {
  id: string;
  unit: string;
  stage: string;
  status?: string;
}
