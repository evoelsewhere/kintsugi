import { z } from "zod";

// DTOs for Projects. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/** Entity shape returned by the API. */
export interface Project {
  id: string;
  name: string;
  code: string;
  status?: string;
}
