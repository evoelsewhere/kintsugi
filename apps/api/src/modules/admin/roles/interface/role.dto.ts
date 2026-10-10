// Interface layer: request schemas and mapping for installation access roles & permissions (ADR-0016).

import { z } from "zod";
import { idSchema, stringField } from "../../../../common/interface/dto.js";
import type { CreateSubRole } from "../domain/role.js";

export const createSubRoleSchema = z.object({
  id: idSchema,
  name: stringField(),
  description: stringField(true),
});
export type CreateSubRoleInput = z.infer<typeof createSubRoleSchema>;

export const setPermissionsSchema = z.object({
  permissions: z.array(z.string().min(1)),
});
export type SetPermissionsInput = z.infer<typeof setPermissionsSchema>;

export function toCreateCommand(input: CreateSubRoleInput): CreateSubRole {
  return { ...input };
}
