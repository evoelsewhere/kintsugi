// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "#common/interface/dto.js";
import type { UpdateHealthCheck } from "../application/health-checks.service.js";
import type { CreateHealthCheck } from "../domain/health-check.js";

export const createHealthCheckSchema = z.object({
  application: stringField(false),
  status: stringField(true),
});
export type CreateHealthCheckInput = z.infer<typeof createHealthCheckSchema>;

export const updateHealthCheckSchema = createHealthCheckSchema.partial();
export type UpdateHealthCheckInput = z.infer<typeof updateHealthCheckSchema>;

export function toCreateCommand(input: CreateHealthCheckInput): CreateHealthCheck {
  return { ...input };
}

export function toUpdateCommand(input: UpdateHealthCheckInput): UpdateHealthCheck {
  return { ...input };
}
