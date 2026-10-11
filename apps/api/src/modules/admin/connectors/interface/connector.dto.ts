// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "#common/interface/dto.js";
import type { UpdateConnector } from "../application/connectors.service.js";
import type { CreateConnector } from "../domain/connector.js";

export const createConnectorSchema = z.object({
  kind: stringField(false),
  name: stringField(false),
  status: stringField(true),
});
export type CreateConnectorInput = z.infer<typeof createConnectorSchema>;

export const updateConnectorSchema = createConnectorSchema.partial();
export type UpdateConnectorInput = z.infer<typeof updateConnectorSchema>;

export function toCreateCommand(input: CreateConnectorInput): CreateConnector {
  return { ...input };
}

export function toUpdateCommand(input: UpdateConnectorInput): UpdateConnector {
  return { ...input };
}
