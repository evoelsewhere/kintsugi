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

const unitKey = z.union([z.literal("@app"), z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}\/[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/, "must be <module>/<unit>")]);

/** Body of POST design/runs: the design set and the units to generate it for (`@app` for a set of the application), `regenerate` to write it again over an existing design, or a failed run to resume. */
export const designRunSchema = z
  .object({
    set: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, "must be a design set id").optional(),
    units: z.array(unitKey).max(500).optional(),
    resumeOf: z.string().min(1).max(128).optional(),
    /** Write the set again for units that already have it (ADR-0081). */
    regenerate: z.boolean().optional(),
  })
  .refine((body) => body.resumeOf !== undefined || (body.set !== undefined && (body.units?.length ?? 0) > 0), "name the design set and at least one unit, or a run to resume");
export type DesignRunBody = z.infer<typeof designRunSchema>;
