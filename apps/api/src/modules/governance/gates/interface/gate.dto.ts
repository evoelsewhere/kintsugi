// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "#common/interface/dto.js";
import type { UpdateGate } from "../application/gates.service.js";
import type { CreateGate } from "../domain/gate.js";

export const createGateSchema = z.object({
  gate: stringField(false),
  status: stringField(true),
});
export type CreateGateInput = z.infer<typeof createGateSchema>;

export const updateGateSchema = createGateSchema.partial();
export type UpdateGateInput = z.infer<typeof updateGateSchema>;

export function toCreateCommand(input: CreateGateInput): CreateGate {
  return { ...input };
}

export function toUpdateCommand(input: UpdateGateInput): UpdateGate {
  return { ...input };
}
