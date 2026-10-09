// Shared interface kernel: request-schema helpers (ADR-0016: Standard Schema).

import { z } from "zod";

/** Lowercase kebab-case identifier, e.g. "billing-web". */
export const idSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase kebab-case");

/** Short free-text field used by the skeleton DTOs. */
export function stringField(): z.ZodString;
export function stringField(optional: false): z.ZodString;
export function stringField(optional: true): z.ZodOptional<z.ZodString>;
export function stringField(optional = false): z.ZodString | z.ZodOptional<z.ZodString> {
  return optional ? z.string().max(200).optional() : z.string().min(1).max(200);
}
