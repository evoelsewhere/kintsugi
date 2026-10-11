// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "#common/interface/dto.js";
import type { UpdateFactorySetup } from "../application/factory-setups.service.js";
import type { CreateFactorySetup } from "../domain/factory-setup.js";

export const createFactorySetupSchema = z.object({
  application: stringField(false),
  stage: stringField(false),
  status: stringField(true),
});
export type CreateFactorySetupInput = z.infer<typeof createFactorySetupSchema>;

export const updateFactorySetupSchema = createFactorySetupSchema.partial();
export type UpdateFactorySetupInput = z.infer<typeof updateFactorySetupSchema>;

export function toCreateCommand(input: CreateFactorySetupInput): CreateFactorySetup {
  return { ...input };
}

export function toUpdateCommand(input: UpdateFactorySetupInput): UpdateFactorySetup {
  return { ...input };
}
