// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdateIncident } from "../application/incidents.service.js";
import type { CreateIncident } from "../domain/incident.js";

export const createIncidentSchema = z.object({
  application: stringField(false),
  severity: stringField(false),
  status: stringField(true),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

export const updateIncidentSchema = createIncidentSchema.partial();
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;

export function toCreateCommand(input: CreateIncidentInput): CreateIncident {
  return { ...input };
}

export function toUpdateCommand(input: UpdateIncidentInput): UpdateIncident {
  return { ...input };
}
