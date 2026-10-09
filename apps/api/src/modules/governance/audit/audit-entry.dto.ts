import { z } from "zod";

// DTOs for AuditEntries. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createAuditEntrySchema = z.object({
  actor: z.string().min(1).max(200),
  action: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateAuditEntryInput = z.infer<typeof createAuditEntrySchema>;

export const updateAuditEntrySchema = createAuditEntrySchema.partial();
export type UpdateAuditEntryInput = z.infer<typeof updateAuditEntrySchema>;

/** Entity shape returned by the API. */
export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  status?: string;
}
