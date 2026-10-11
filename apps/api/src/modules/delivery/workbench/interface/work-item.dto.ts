// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "#common/interface/dto.js";
import type { UpdateWorkItem } from "../application/work-items.service.js";
import type { CreateWorkItem } from "../domain/work-item.js";

export const createWorkItemSchema = z.object({
  unit: stringField(false),
  stage: stringField(false),
  status: stringField(true),
});
export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>;

export const updateWorkItemSchema = createWorkItemSchema.partial();
export type UpdateWorkItemInput = z.infer<typeof updateWorkItemSchema>;

export function toCreateCommand(input: CreateWorkItemInput): CreateWorkItem {
  return { ...input };
}

export function toUpdateCommand(input: UpdateWorkItemInput): UpdateWorkItem {
  return { ...input };
}
