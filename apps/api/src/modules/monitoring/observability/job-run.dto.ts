import { z } from "zod";

// DTOs for JobRuns. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createJobRunSchema = z.object({
  agent: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateJobRunInput = z.infer<typeof createJobRunSchema>;

export const updateJobRunSchema = createJobRunSchema.partial();
export type UpdateJobRunInput = z.infer<typeof updateJobRunSchema>;

/** Entity shape returned by the API. */
export interface JobRun {
  id: string;
  agent: string;
  status?: string;
}
