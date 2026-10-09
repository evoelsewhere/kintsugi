import { z } from "zod";

// DTOs for Incidents. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createIncidentSchema = z.object({
  application: z.string().min(1).max(200),
  severity: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

export const updateIncidentSchema = createIncidentSchema.partial();
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;

/** Entity shape returned by the API. */
export interface Incident {
  id: string;
  application: string;
  severity: string;
  status?: string;
}
