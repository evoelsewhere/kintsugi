import { z } from "zod";

// DTOs for RulebookEntries. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createRulebookEntrySchema = z.object({
  capability: z.string().min(1).max(200),
  maturity: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateRulebookEntryInput = z.infer<typeof createRulebookEntrySchema>;

export const updateRulebookEntrySchema = createRulebookEntrySchema.partial();
export type UpdateRulebookEntryInput = z.infer<typeof updateRulebookEntrySchema>;

/** Entity shape returned by the API. */
export interface RulebookEntry {
  id: string;
  capability: string;
  maturity: string;
  status?: string;
}
