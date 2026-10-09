// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdateDashboardStat } from "../application/dashboard-stats.service.js";
import type { CreateDashboardStat } from "../domain/dashboard-stat.js";

export const createDashboardStatSchema = z.object({
  metric: stringField(false),
  value: stringField(false),
  status: stringField(true),
});
export type CreateDashboardStatInput = z.infer<typeof createDashboardStatSchema>;

export const updateDashboardStatSchema = createDashboardStatSchema.partial();
export type UpdateDashboardStatInput = z.infer<typeof updateDashboardStatSchema>;

export function toCreateCommand(input: CreateDashboardStatInput): CreateDashboardStat {
  return { ...input };
}

export function toUpdateCommand(input: UpdateDashboardStatInput): UpdateDashboardStat {
  return { ...input };
}
