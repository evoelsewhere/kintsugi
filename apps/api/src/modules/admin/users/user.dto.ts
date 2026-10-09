import { z } from "zod";

// DTOs for Users. Request schemas are Standard Schema (ADR-0016): they validate via
// `StandardSchemaValidationPipe` and feed OpenAPI generation.

export const createUserSchema = z.object({
  username: z.string().min(1).max(200),
  role: z.string().min(1).max(200),
  status: z.string().max(200).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.partial();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** Entity shape returned by the API. */
export interface User {
  id: string;
  username: string;
  role: string;
  status?: string;
}
