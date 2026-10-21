// Request schemas of the design views (ADR-0016: Standard Schema via zod).

import { z } from "zod";

const ref = z
  .string()
  .max(300)
  .regex(/^([0-9a-f]{40}|[0-9a-f]{64}|refs\/heads\/[A-Za-z0-9._/-]+)$/, "must be a commit id or refs/heads/<branch>")
  .optional();

/** `?ref` of the design views: a commit id or `refs/heads/<branch>` (default: the default branch). */
export const designQuerySchema = z.object({ ref });
export type DesignQuery = z.infer<typeof designQuerySchema>;

/** `?ref` and `?app` of the design sets: with an application, each set reports how its units stand. */
export const designSetsQuerySchema = z.object({ ref, app: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "must be an application id").optional() });
export type DesignSetsQuery = z.infer<typeof designSetsQuerySchema>;
