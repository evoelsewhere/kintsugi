import { z } from "zod";

// DTOs for Connectors. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createConnectorSchema = z.object({
  kind: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateConnectorInput = z.infer<typeof createConnectorSchema>;

export const updateConnectorSchema = createConnectorSchema.partial();
export type UpdateConnectorInput = z.infer<typeof updateConnectorSchema>;

/** Entity shape returned by the API. */
export interface Connector {
  id: string;
  kind: string;
  name: string;
  status?: string;
}
