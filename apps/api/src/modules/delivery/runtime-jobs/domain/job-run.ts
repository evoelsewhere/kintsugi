// Domain of runtime job runs (ADR-0027, ADR-0029): a pipeline stage, script step, agent job or
// workflow the worker runs in a job workspace, with its steps, the artifacts it produced and
// the document write that carries them to the document repo. The API records a stage run as
// `queued` and enqueues it; the worker records everything else. Pure types.

import type { Provenance } from "@kintsugi/domain";

export type JobRunKind = "stage" | "script" | "agent" | "workflow";
export type JobRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** Statuses a run does not leave. */
export const FINAL_RUN_STATUSES: readonly JobRunStatus[] = ["succeeded", "failed", "cancelled"];

export type JobRunEventKind = "status" | "step.started" | "step.finished" | "tool" | "log";

/** One line of a run's live record (workflow.job_event), recorded by the worker; redacted, never file content. */
export interface JobRunEventView {
  /** Increasing; the SSE event id (resume with Last-Event-ID). */
  id: string;
  at: string;
  kind: JobRunEventKind;
  message: string;
  /** The step (child run) the event came from. */
  stepRunId?: string;
  data: Record<string, unknown>;
}

/** What a client following a run receives: its events, its status when it changes, and the end. */
export type JobRunFollowUpdate = { type: "event"; event: JobRunEventView } | { type: "status"; run: JobRunView } | { type: "end"; run: JobRunView };

/** Outcome of a cancel request. */
export type CancelOutcome = "cancelled" | "requested" | "finished";

/** Stages that can be run from the portal (first milestone: the minimal assess path). */
export const RUNNABLE_STAGES = ["assess"] as const;
export type RunnableStage = (typeof RUNNABLE_STAGES)[number];

export interface ArtifactView {
  /** Path in the document repo (relative to the job's output). */
  path: string;
  sha256: string;
  size: number;
  provenance: Provenance;
}

export interface JobRunDocumentWrite {
  id: string;
  status: string;
  branch?: string;
  prUrl?: string;
  error?: string;
}

export interface JobRunView {
  id: string;
  projectId: string;
  applicationId?: string;
  parentId?: string;
  kind: JobRunKind;
  name: string;
  status: JobRunStatus;
  /** Redacted. */
  failureReason?: string;
  sourceRepositoryId?: string;
  sourceCommit?: string;
  scriptHash?: string;
  agent?: string;
  actor?: string;
  outputSummary?: Record<string, unknown>;
  documentWrite?: JobRunDocumentWrite;
  /** Number of restricted records (never their content or names). */
  restrictedRecords: number;
  /** Set when a person asked to cancel the run while it was running. */
  cancelRequestedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface JobRunDetail extends JobRunView {
  steps: JobRunView[];
  artifacts: ArtifactView[];
}

/** One restricted file of a run (or of one of its steps), decrypted for an authorized reader. */
export interface RestrictedRecordView {
  jobRunId: string;
  path: string;
  size: number;
  content: string;
  createdAt: string;
}

export interface NewStageRun {
  id: string;
  projectId: string;
  applicationId: string;
  stage: RunnableStage;
  sourceRepositoryId: string;
  actor?: string;
}
