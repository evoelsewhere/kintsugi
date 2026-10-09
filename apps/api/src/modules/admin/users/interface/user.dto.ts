// Interface layer: request schemas and HTTP-facing mapping for members (ADR-0016).

import { z } from "zod";
import { idSchema, stringField } from "../../../../common/interface/dto.js";
import type { CreateUser, UpdateUser } from "../domain/user.js";

export const createUserSchema = z.object({
  username: idSchema,
  password: z.string().min(8).max(200),
  email: stringField(true),
  displayName: stringField(true),
  roleIds: z.array(z.string().min(1)).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  email: stringField(true),
  displayName: stringField(true),
  enabled: z.boolean().optional(),
  roleIds: z.array(z.string().min(1)).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const setPasswordSchema = z.object({
  password: z.string().min(8).max(200),
});
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

export function toCreateCommand(input: CreateUserInput): CreateUser {
  return { ...input };
}

export function toUpdateCommand(input: UpdateUserInput): UpdateUser {
  return { ...input };
}
