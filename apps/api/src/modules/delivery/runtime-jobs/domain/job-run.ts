// Domain of runtime job runs (ADR-0027, ADR-0029): a pipeline stage, script step, agent job or
// workflow the worker runs in a job workspace, with its steps, the artifacts it produced and
// the document write that carries them to the document repo. The API records a stage run as
// `queued` and enqueues it; the worker records everything else. Pure types.

import type { Provenance, SourceRepo } from "@kintsugi/domain";

export type JobRunKind = "stage" | "script" | "agent" | "workflow";
export const JOB_RUN_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

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
  /** The attempt of the run the event belongs to. */
  attempt: number;
  data: Record<string, unknown>;
}

/** What a client following a run receives: its events, its status when it changes, and the end. */
export type JobRunFollowUpdate = { type: "event"; event: JobRunEventView } | { type: "status"; run: JobRunView } | { type: "end"; run: JobRunView };

/** Outcome of a cancel request. */
export type CancelOutcome = "cancelled" | "requested" | "finished";

/** A stage the worker has a plan for (runnable from the portal), with what it needs first. */
export interface StagePlanInfo {
  id: string;
  /** Document-repo files written by an earlier stage that this stage reads. */
  requires: Array<{ stage: string; path: string }>;
}

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

/** What one finished attempt of a job did (ADR-0055). */
export interface JobAttemptView {
  n: number;
  status: "succeeded" | "failed" | "cancelled";
  startedAt?: string;
  finishedAt?: string;
  /** Redacted. */
  reason?: string;
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
  /** The first legacy repository (the application may link several, see `sources`). */
  sourceRepositoryId?: string;
  sourceCommit?: string;
  /** Every repository the run reads, each at its commit and with its role: the legacy code and the target code (ADR-0052, ADR-0055). */
  sources?: SourceRepo[];
  /** 1 for the first attempt; a retry of a failed stage run is the next attempt of the same run (ADR-0055). */
  attempt: number;
  /** The attempts that ended, oldest first (top-level runs). */
  attempts?: JobAttemptView[];
  scriptHash?: string;
  agent?: string;
  actor?: string;
  outputSummary?: Record<string, unknown>;
  documentWrite?: JobRunDocumentWrite;
  /** Number of restricted records (never their content or names). */
  restrictedRecords: number;
  /** Set when a person asked to cancel the run while it was running. */
  cancelRequestedAt?: string;
  /** The catalog items an understand run works on (ADR-0033, inputs.scope.items); for a design run the units and the design set (ADR-0049). */
  scope?: { items: string[]; set?: string; regenerate?: boolean; draft?: boolean };
  /** Set when a person abandoned the run's pull request: its items are released. */
  abandonedAt?: string;
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

/**
 * A restricted record without its content, for the governance list: which run and step wrote it,
 * where and when. Listing never decrypts; reading the content is the audited per-run read.
 */
export interface RestrictedRecordSummary {
  jobRunId: string;
  /** The top-level run the record belongs to (the run itself, or the parent of its step). */
  topLevelRunId: string;
  projectId: string;
  applicationId?: string;
  /** Name of the top-level run (e.g. the stage). */
  runName: string;
  /** Name of the step that wrote it, when it was written by a step. */
  stepName?: string;
  path: string;
  size: number;
  createdAt: string;
}

export interface RestrictedRecordFilter {
  projectId?: string;
  /** A top-level run: its records and those of its steps. */
  jobRunId?: string;
}

/** Filter of the cross-project run list (top-level runs only). */
export interface JobRunFilter {
  statuses?: readonly JobRunStatus[];
  projectId?: string;
  applicationId?: string;
}

/** Who runs a pipeline stage. */
export type StageAudience = "runtime" | "member" | "portal";

/** A pipeline stage as the built-in commands define it (ADR-0027). */
export interface StageDefinition {
  /** Stage id, e.g. `assess`, `extract-rules`. */
  id: string;
  /** The command it comes from, e.g. `modernize-assess`. */
  command: string;
  description: string;
  audience: StageAudience;
  agents: string[];
  reads: string[];
  writes: string[];
  gates: string[];
}

/** A stage for the portal: its definition plus whether it can be run from the portal yet. */
export interface StageView extends StageDefinition {
  runnable: boolean;
}

export interface NewStageRun {
  id: string;
  projectId: string;
  applicationId: string;
  stage: string;
  /** The repositories the run reads, at least one legacy; a commit pins it (a retry of the run reads what its first attempt read). */
  sources: SourceRepo[];
  actor?: string;
  /** Run inputs: scope, documentsCommit (ADR-0033). */
  inputs?: Record<string, unknown>;
}
