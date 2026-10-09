// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdateVerificationRun } from "../application/verification-runs.service.js";
import type { CreateVerificationRun } from "../domain/verification-run.js";

export const createVerificationRunSchema = z.object({
  application: stringField(false),
  profile: stringField(false),
  status: stringField(true),
});
export type CreateVerificationRunInput = z.infer<typeof createVerificationRunSchema>;

export const updateVerificationRunSchema = createVerificationRunSchema.partial();
export type UpdateVerificationRunInput = z.infer<typeof updateVerificationRunSchema>;

export function toCreateCommand(input: CreateVerificationRunInput): CreateVerificationRun {
  return { ...input };
}

export function toUpdateCommand(input: UpdateVerificationRunInput): UpdateVerificationRun {
  return { ...input };
}
