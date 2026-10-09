import { z } from "zod";

// DTOs for ProjectBuilds. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createProjectBuildSchema = z.object({
  application: z.string().min(1).max(200),
  readiness: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateProjectBuildInput = z.infer<typeof createProjectBuildSchema>;

export const updateProjectBuildSchema = createProjectBuildSchema.partial();
export type UpdateProjectBuildInput = z.infer<typeof updateProjectBuildSchema>;

/** Entity shape returned by the API. */
export interface ProjectBuild {
  id: string;
  application: string;
  readiness: string;
  status?: string;
}
