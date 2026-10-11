// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "#common/interface/dto.js";
import type { UpdateJobRun } from "../application/job-runs.service.js";
import type { CreateJobRun } from "../domain/job-run.js";

export const createJobRunSchema = z.object({
  agent: stringField(false),
  status: stringField(true),
});
export type CreateJobRunInput = z.infer<typeof createJobRunSchema>;

export const updateJobRunSchema = createJobRunSchema.partial();
export type UpdateJobRunInput = z.infer<typeof updateJobRunSchema>;

export function toCreateCommand(input: CreateJobRunInput): CreateJobRun {
  return { ...input };
}

export function toUpdateCommand(input: UpdateJobRunInput): UpdateJobRun {
  return { ...input };
}
