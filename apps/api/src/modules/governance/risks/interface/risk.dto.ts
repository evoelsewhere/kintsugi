// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "#common/interface/dto.js";
import type { UpdateRisk } from "../application/risks.service.js";
import type { CreateRisk } from "../domain/risk.js";

export const createRiskSchema = z.object({
  title: stringField(false),
  severity: stringField(false),
  status: stringField(true),
});
export type CreateRiskInput = z.infer<typeof createRiskSchema>;

export const updateRiskSchema = createRiskSchema.partial();
export type UpdateRiskInput = z.infer<typeof updateRiskSchema>;

export function toCreateCommand(input: CreateRiskInput): CreateRisk {
  return { ...input };
}

export function toUpdateCommand(input: UpdateRiskInput): UpdateRisk {
  return { ...input };
}
