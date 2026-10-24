// Request schemas of the build views (ADR-0016: Standard Schema via zod).

import { z } from "zod";

const unitKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}\/[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/, "must be <module>/<unit>");

/** Body of POST build/reviews: the units of one merge request a member recorded, and the target repository it is on. */
export const reviewRunSchema = z.object({
  units: z.array(unitKey).min(1).max(500),
  target: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/i, "must be a repository id")
    .optional(),
});
export type ReviewRunInput = z.infer<typeof reviewRunSchema>;
