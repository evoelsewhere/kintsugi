// Ports of runtime job runs — the DI tokens of this module: where runs are recorded
// (Postgres, workflow.job_run and friends) and how they reach the worker (the job queue).

import type { JobRunDetail, JobRunView, NewStageRun, RestrictedRecordView } from "./job-run.js";

export abstract class JobRunStore {
  /** Records a stage run as `queued`. */
  abstract createStageRun(run: NewStageRun): Promise<JobRunView>;
  /** Top-level runs of a project (optionally one application), newest first, with the total. */
  abstract list(projectId: string, applicationId: string | undefined, limit: number, offset: number): Promise<{ items: JobRunView[]; total: number }>;
  /** A run of the project with its steps and artifacts; undefined when unknown. */
  abstract get(projectId: string, id: string): Promise<JobRunDetail | undefined>;
  /** The restricted records of a run and its steps, decrypted. */
  abstract restricted(projectId: string, id: string): Promise<RestrictedRecordView[]>;
  /** Marks a run failed before it reached the worker. */
  abstract markFailed(id: string, reason: string): Promise<void>;
}

export abstract class JobRunQueue {
  /** Hands the run to the worker (queue `job-run`). */
  abstract enqueue(jobRunId: string): Promise<void>;
}
