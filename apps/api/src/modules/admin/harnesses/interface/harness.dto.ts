// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdateHarness } from "../application/harnesses.service.js";
import type { CreateHarness } from "../domain/harness.js";

export const createHarnessSchema = z.object({
  name: stringField(false),
  support: stringField(false),
  status: stringField(true),
});
export type CreateHarnessInput = z.infer<typeof createHarnessSchema>;

export const updateHarnessSchema = createHarnessSchema.partial();
export type UpdateHarnessInput = z.infer<typeof updateHarnessSchema>;

export function toCreateCommand(input: CreateHarnessInput): CreateHarness {
  return { ...input };
}

export function toUpdateCommand(input: UpdateHarnessInput): UpdateHarness {
  return { ...input };
}
