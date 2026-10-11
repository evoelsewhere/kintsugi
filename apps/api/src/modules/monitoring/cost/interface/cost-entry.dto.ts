// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "#common/interface/dto.js";
import type { UpdateCostEntry } from "../application/cost-entries.service.js";
import type { CreateCostEntry } from "../domain/cost-entry.js";

export const createCostEntrySchema = z.object({
  model: stringField(false),
  costUsd: stringField(false),
  status: stringField(true),
});
export type CreateCostEntryInput = z.infer<typeof createCostEntrySchema>;

export const updateCostEntrySchema = createCostEntrySchema.partial();
export type UpdateCostEntryInput = z.infer<typeof updateCostEntrySchema>;

export function toCreateCommand(input: CreateCostEntryInput): CreateCostEntry {
  return { ...input };
}

export function toUpdateCommand(input: UpdateCostEntryInput): UpdateCostEntry {
  return { ...input };
}
