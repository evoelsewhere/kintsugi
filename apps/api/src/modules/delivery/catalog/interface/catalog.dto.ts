// Request schemas of the item catalog (ADR-0016: Standard Schema via zod).

import { z } from "zod";

/** `?ref` of the catalog: a commit id or `refs/heads/<branch>` (default: the default branch). */
export const catalogQuerySchema = z.object({
  ref: z
    .string()
    .max(300)
    .regex(/^([0-9a-f]{40}|[0-9a-f]{64}|refs\/heads\/[A-Za-z0-9._/-]+)$/, "must be a commit id or refs/heads/<branch>")
    .optional(),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
