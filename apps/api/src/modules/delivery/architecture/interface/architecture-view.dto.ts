// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "#common/interface/dto.js";
import type { UpdateArchitectureView } from "../application/architecture-views.service.js";
import type { CreateArchitectureView } from "../domain/architecture-view.js";

export const createArchitectureViewSchema = z.object({
  application: stringField(false),
  kind: stringField(false),
  status: stringField(true),
});
export type CreateArchitectureViewInput = z.infer<typeof createArchitectureViewSchema>;

export const updateArchitectureViewSchema = createArchitectureViewSchema.partial();
export type UpdateArchitectureViewInput = z.infer<typeof updateArchitectureViewSchema>;

export function toCreateCommand(input: CreateArchitectureViewInput): CreateArchitectureView {
  return { ...input };
}

export function toUpdateCommand(input: UpdateArchitectureViewInput): UpdateArchitectureView {
  return { ...input };
}
