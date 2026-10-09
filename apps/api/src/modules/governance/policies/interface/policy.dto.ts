// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdatePolicy } from "../application/policies.service.js";
import type { CreatePolicy } from "../domain/policy.js";

export const createPolicySchema = z.object({
  name: stringField(false),
  scope: stringField(false),
  status: stringField(true),
});
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;

export const updatePolicySchema = createPolicySchema.partial();
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;

export function toCreateCommand(input: CreatePolicyInput): CreatePolicy {
  return { ...input };
}

export function toUpdateCommand(input: UpdatePolicyInput): UpdatePolicy {
  return { ...input };
}
