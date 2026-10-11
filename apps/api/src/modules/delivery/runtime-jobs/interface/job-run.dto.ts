// Request schemas of runtime job runs (ADR-0016: Standard Schema via zod).

import { z } from "zod";
import { pageQuerySchema } from "#common/interface/pagination.js";

/** `?applicationId&limit&offset` of the job run list. */
export const listJobRunsQuerySchema = pageQuerySchema.extend({ applicationId: z.string().min(1).max(128).optional() });
export type ListJobRunsQuery = z.infer<typeof listJobRunsQuerySchema>;
