// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdateCutoverChecklist } from "../application/cutover-checklists.service.js";
import type { CreateCutoverChecklist } from "../domain/cutover-checklist.js";

export const createCutoverChecklistSchema = z.object({
  application: stringField(false),
  decision: stringField(false),
  status: stringField(true),
});
export type CreateCutoverChecklistInput = z.infer<typeof createCutoverChecklistSchema>;

export const updateCutoverChecklistSchema = createCutoverChecklistSchema.partial();
export type UpdateCutoverChecklistInput = z.infer<typeof updateCutoverChecklistSchema>;

export function toCreateCommand(input: CreateCutoverChecklistInput): CreateCutoverChecklist {
  return { ...input };
}

export function toUpdateCommand(input: UpdateCutoverChecklistInput): UpdateCutoverChecklist {
  return { ...input };
}
