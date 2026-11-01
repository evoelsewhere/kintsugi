// Shared interface kernel: request-schema helpers (ADR-0016: Standard Schema).

import { IDENTIFIER_MAX_LENGTH, IDENTIFIER_PATTERN } from "@kintsugi/domain";
import { z } from "zod";

/** Lowercase kebab-case identifier, e.g. "billing-web". */
export const idSchema = z
  .string()
  .min(1)
  .max(IDENTIFIER_MAX_LENGTH)
  .regex(IDENTIFIER_PATTERN, "must be lowercase kebab-case");

/**
 * A name a resource cannot take because a fixed route beside it has it (`GET /admin/agents/context` would answer
 * instead of an agent `context`); refused with a 400 that names the word.
 */
export function notReserved<S extends z.ZodType<string>>(schema: S, reserved: readonly string[]) {
  return schema.refine((name) => !reserved.includes(name), { message: `This name is used by the API itself (${reserved.join(", ")}); choose another` });
}

/** Short free-text field used by the skeleton DTOs. */
export function stringField(): z.ZodString;
export function stringField(optional: false): z.ZodString;
export function stringField(optional: true): z.ZodOptional<z.ZodString>;
export function stringField(optional = false): z.ZodString | z.ZodOptional<z.ZodString> {
  return optional ? z.string().max(200).optional() : z.string().min(1).max(200);
}

/**
 * A comma-separated list of allowed values in a query string, e.g. `?status=queued,running`;
 * parses to the distinct values, and refuses unknown ones (400).
 */
export function enumListQuery<const T extends readonly [string, ...string[]]>(values: T) {
  const value = z.enum(values);
  return z
    .string()
    .max(500)
    .transform((text) => [...new Set(text.split(",").map((entry) => entry.trim()).filter((entry) => entry !== ""))])
    .pipe(z.array(value).min(1, `must list at least one of ${values.join(", ")}`));
}
