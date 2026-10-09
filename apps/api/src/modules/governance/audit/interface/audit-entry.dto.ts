// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdateAuditEntry } from "../application/audit-entries.service.js";
import type { CreateAuditEntry } from "../domain/audit-entry.js";

export const createAuditEntrySchema = z.object({
  actor: stringField(false),
  action: stringField(false),
  status: stringField(true),
});
export type CreateAuditEntryInput = z.infer<typeof createAuditEntrySchema>;

export const updateAuditEntrySchema = createAuditEntrySchema.partial();
export type UpdateAuditEntryInput = z.infer<typeof updateAuditEntrySchema>;

export function toCreateCommand(input: CreateAuditEntryInput): CreateAuditEntry {
  return { ...input };
}

export function toUpdateCommand(input: UpdateAuditEntryInput): UpdateAuditEntry {
  return { ...input };
}
