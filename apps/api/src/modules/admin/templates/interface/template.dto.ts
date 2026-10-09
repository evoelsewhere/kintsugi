// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdateTemplate } from "../application/templates.service.js";
import type { CreateTemplate } from "../domain/template.js";

export const createTemplateSchema = z.object({
  name: stringField(false),
  kind: stringField(false),
  status: stringField(true),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = createTemplateSchema.partial();
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export function toCreateCommand(input: CreateTemplateInput): CreateTemplate {
  return { ...input };
}

export function toUpdateCommand(input: UpdateTemplateInput): UpdateTemplate {
  return { ...input };
}
