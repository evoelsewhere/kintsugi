// Request schemas of runtime job runs (ADR-0016: Standard Schema via zod).

import { z } from "zod";
import { pageQuerySchema } from "#common/interface/pagination.js";

/** `?applicationId&limit&offset` of the job run list. */
export const listJobRunsQuerySchema = pageQuerySchema.extend({ applicationId: z.string().min(1).max(128).optional() });
export type ListJobRunsQuery = z.infer<typeof listJobRunsQuerySchema>;

/** An event id (workflow.job_event.id). */
export const eventIdSchema = z.string().regex(/^\d{1,18}$/, "must be an event id");

/** `?after=<event id>` of the event stream (EventSource resumes with the Last-Event-ID header instead). */
export const jobRunEventsQuerySchema = z.object({ after: eventIdSchema.optional() });
export type JobRunEventsQuery = z.infer<typeof jobRunEventsQuerySchema>;
