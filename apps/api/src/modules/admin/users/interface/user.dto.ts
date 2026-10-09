// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdateUser } from "../application/users.service.js";
import type { CreateUser } from "../domain/user.js";

export const createUserSchema = z.object({
  username: stringField(false),
  role: stringField(false),
  status: stringField(true),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.partial();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export function toCreateCommand(input: CreateUserInput): CreateUser {
  return { ...input };
}

export function toUpdateCommand(input: UpdateUserInput): UpdateUser {
  return { ...input };
}
