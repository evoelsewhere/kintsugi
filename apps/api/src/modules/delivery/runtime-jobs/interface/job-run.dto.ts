// Request schemas of runtime job runs (ADR-0016: Standard Schema via zod).

import { z } from "zod";
import { enumListQuery } from "#common/interface/dto.js";
import { pageQuerySchema } from "#common/interface/pagination.js";
import { JOB_RUN_STATUSES } from "../domain/job-run.js";

const filterId = z.string().min(1).max(128).optional();

/** `?applicationId&limit&offset` of the job run list. */
export const listJobRunsQuerySchema = pageQuerySchema.extend({ applicationId: filterId });
export type ListJobRunsQuery = z.infer<typeof listJobRunsQuerySchema>;

/** `?status=queued,running&projectId&applicationId&limit&offset` of the cross-project run list. */
export const listAllJobRunsQuerySchema = pageQuerySchema.extend({ status: enumListQuery(JOB_RUN_STATUSES).optional(), projectId: filterId, applicationId: filterId });
export type ListAllJobRunsQuery = z.infer<typeof listAllJobRunsQuerySchema>;

/** `?projectId&jobRunId&limit&offset` of the restricted record list (jobRunId: a top-level run). */
export const listRestrictedRecordsQuerySchema = pageQuerySchema.extend({ projectId: filterId, jobRunId: filterId });
export type ListRestrictedRecordsQuery = z.infer<typeof listRestrictedRecordsQuerySchema>;

/** Body of POST retry: `fresh` discards what the job kept and begins from nothing (ADR-0055). */
export const retryBodySchema = z.object({ fresh: z.boolean().optional() }).default({});
export type RetryBody = z.infer<typeof retryBodySchema>;

/** An event id (workflow.job_event.id). */
export const eventIdSchema = z.string().regex(/^\d{1,18}$/, "must be an event id");

/** `?after=<event id>` of the event stream (EventSource resumes with the Last-Event-ID header instead). */
export const jobRunEventsQuerySchema = z.object({ after: eventIdSchema.optional() });
export type JobRunEventsQuery = z.infer<typeof jobRunEventsQuerySchema>;
