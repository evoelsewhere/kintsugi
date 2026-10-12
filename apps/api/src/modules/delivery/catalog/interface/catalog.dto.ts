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

const catalogId = z.string().min(1).max(130);

/** Body of POST understand/runs: items and whole modules to understand, or a failed run to resume. */
export const understandRunSchema = z
  .object({
    items: z.array(catalogId).max(500).optional(),
    modules: z.array(z.string().min(1).max(63)).max(100).optional(),
    resumeOf: z.string().min(1).max(128).optional(),
  })
  .refine((body) => body.resumeOf !== undefined || (body.items?.length ?? 0) + (body.modules?.length ?? 0) > 0, "select items or modules, or name a run to resume");
export type UnderstandRunBody = z.infer<typeof understandRunSchema>;
