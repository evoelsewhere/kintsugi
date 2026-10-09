// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdateRulebookEntry } from "../application/rulebook-entries.service.js";
import type { CreateRulebookEntry } from "../domain/rulebook-entry.js";

export const createRulebookEntrySchema = z.object({
  capability: stringField(false),
  maturity: stringField(false),
  status: stringField(true),
});
export type CreateRulebookEntryInput = z.infer<typeof createRulebookEntrySchema>;

export const updateRulebookEntrySchema = createRulebookEntrySchema.partial();
export type UpdateRulebookEntryInput = z.infer<typeof updateRulebookEntrySchema>;

export function toCreateCommand(input: CreateRulebookEntryInput): CreateRulebookEntry {
  return { ...input };
}

export function toUpdateCommand(input: UpdateRulebookEntryInput): UpdateRulebookEntry {
  return { ...input };
}
