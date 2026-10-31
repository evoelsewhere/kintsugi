// Ports of runtime job runs — the DI tokens of this module: where runs are recorded
// (Postgres, workflow.job_run and friends) and how they reach the worker (the job queue).

import type {
  CancelOutcome,
  JobRunDetail,
  JobRunEventView,
  JobRunFilter,
  JobRunView,
  JobRunStatus,
  NewStageRun,
  RestrictedRecordFilter,
  RestrictedRecordSummary,
  RestrictedRecordView,
  StageDefinition,
  StagePlanInfo,
} from "./job-run.js";

export abstract class JobRunStore {
  /** Records a stage run as `queued`, atomically refusing overlapping understand/design scopes (RunScopeConflict). */
  abstract createStageRun(run: NewStageRun): Promise<JobRunView>;
  /** Top-level runs of a project (optionally one application), newest first, with the total. */
  abstract list(projectId: string, applicationId: string | undefined, limit: number, offset: number): Promise<{ items: JobRunView[]; total: number }>;
  /** Top-level runs across projects, newest first, with the total. */
  abstract listAll(filter: JobRunFilter, limit: number, offset: number): Promise<{ items: JobRunView[]; total: number }>;
  /** A run of the project with its steps and artifacts; undefined when unknown. */
  abstract get(projectId: string, id: string): Promise<JobRunDetail | undefined>;
  /** The restricted records of a run and its steps, decrypted. */
  abstract restricted(projectId: string, id: string): Promise<RestrictedRecordView[]>;
  /** Restricted records across projects without their content (never decrypted), newest first, with the total. */
  abstract restrictedSummaries(filter: RestrictedRecordFilter, limit: number, offset: number): Promise<{ items: RestrictedRecordSummary[]; total: number }>;
  /** A run of the project without its steps and artifacts; undefined when unknown. */
  abstract summary(projectId: string, id: string): Promise<JobRunView | undefined>;
  /**
   * Cancels a queued run at once ("cancelled"), or asks the worker to cancel a running one
   * ("requested"); "finished" when the run had already ended.
   */
  abstract cancel(projectId: string, id: string, actor: string): Promise<CancelOutcome>;
  /** Events of a run after the given event id, oldest first. */
  abstract events(id: string, afterId: string | undefined, limit: number): Promise<JobRunEventView[]>;
  /** Whether the application has a top-level run of `stage` in one of `statuses`. */
  abstract hasStageRun(projectId: string, applicationId: string, stage: string, statuses: readonly JobRunStatus[]): Promise<boolean>;
  /** Marks a succeeded run's pull request abandoned; false when it was already abandoned. */
  abstract abandon(projectId: string, id: string, actor: string): Promise<boolean>;
  /** The inputs a run was started with (scope, documentsCommit, fresh); undefined when unknown. */
  abstract inputs(projectId: string, id: string): Promise<Record<string, unknown> | undefined>;
  /** The runtime agents of the project that may look things up on the web (empty when web lookups are off). */
  abstract webLookupAgents(projectId: string): Promise<string[]>;
  /**
   * Puts a failed or cancelled top-level run back in the queue as its next attempt (ADR-0055, ADR-0090): attempt + 1,
   * no failure, no cancel request; `fresh` asks the worker to begin from nothing; `documentsCommit` pins the documents
   * the run read when its inputs do not say. False when the run is not failed or cancelled (a race). Scope claims are atomic with
   * this update; RunScopeConflict reports overlap or pins made stale by a competing merge.
   */
  abstract requeue(projectId: string, id: string, options: { fresh: boolean; documentsCommit?: string }): Promise<boolean>;
  /** Marks a run failed before it reached the worker. */
  abstract markFailed(id: string, reason: string): Promise<void>;
}

export abstract class JobRunQueue {
  /** Hands the run to the worker (queue `job-run`). */
  abstract enqueue(jobRunId: string): Promise<void>;
}

export abstract class StageCatalog {
  /** The pipeline stages, in pipeline order. */
  abstract list(): Promise<StageDefinition[]>;
  /** The stages the worker has a plan for, prerequisites filled for `applicationId` when given. */
  abstract plans(applicationId?: string): StagePlanInfo[];
}
