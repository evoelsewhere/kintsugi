// Job runs (workflow.job_run, migration 010; ADR-0027, ADR-0029): what the worker records
// about every runtime step it runs, and the ports the job runner depends on. A stage is a
// sequence of steps; each step is a child run with its own job workspace.

import type { Provenance, SourceRepo } from "@kintsugi/domain";
import type { JobSpan } from "@kintsugi/runtime-sdk";
import type { DocumentWriteRequest } from "../queues.js";

export type JobKind = "stage" | "script" | "agent" | "workflow";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface StepLimits {
  /** Wall clock, seconds. */
  timeoutSec: number;
  /** Bytes a step may write to its output directory. */
  maxOutputBytes: number;
  /** Agent jobs only. */
  maxTurns?: number;
  maxCostUsd?: number;
}

export interface JobRun {
  id: string;
  projectId: string;
  applicationId?: string;
  parentId?: string;
  kind: JobKind;
  /** Stage id, script file, agent id or workflow id. */
  name: string;
  status: JobStatus;
  failureReason?: string;
  /** The first legacy repository and its commit; `sources` lists every one the run reads (ADR-0052). */
  sourceRepositoryId?: string;
  sourceCommit?: string;
  sources?: SourceRepo[];
  inputs: Record<string, unknown>;
  limits: Partial<StepLimits>;
  scriptHash?: string;
  /** `<agent>@<version>`. */
  agent?: string;
  actor?: string;
  outputSummary?: Record<string, unknown>;
  documentWriteId?: string;
}

export interface NewJobRun {
  id: string;
  projectId: string;
  applicationId?: string;
  parentId?: string;
  kind: JobKind;
  name: string;
  sourceRepositoryId?: string;
  sourceCommit?: string;
  sources?: SourceRepo[];
  inputs?: Record<string, unknown>;
  limits?: Partial<StepLimits>;
  actor?: string;
}

/** One file a run produced, relative to its output directory. */
export interface ArtifactEntry {
  path: string;
  sha256: string;
  size: number;
  provenance: Provenance;
}

export interface ModelBinding {
  provider: string;
  model: string;
  thinking?: string;
}

export type JobEventKind = "status" | "step.started" | "step.finished" | "tool" | "log";

/** One line of a run's live record (workflow.job_event): redacted, never file content. */
export interface JobEventRecord {
  /** The top-level run the event belongs to. */
  runId: string;
  /** The step (child run) it came from; undefined for the run itself. */
  stepId?: string;
  kind: JobEventKind;
  message: string;
  data?: Record<string, unknown>;
}

/** One settled span of an agent attempt (monitoring.telemetry_span, ADR-0048). */
export interface SpanRecord {
  /** The top-level run, and the agent step (child run) when it is one. */
  runId: string;
  stepId?: string;
  projectId: string;
  applicationId?: string;
  /** `<agent>@<version>`, the provider config id and the model id. */
  agent: string;
  provider: string;
  model: string;
  /** 1 for the first run of the step, 2 for a retry or a repair run. */
  attempt: number;
  span: JobSpan;
}

/** Persistence of job runs and what they need to know about the project. */
export interface JobStore {
  get(id: string): Promise<JobRun | undefined>;
  create(run: NewJobRun): Promise<void>;
  /** queued → running; false when the run is no longer queued (cancelled before it started). */
  start(id: string): Promise<boolean>;
  update(id: string, patch: { sources?: SourceRepo[]; scriptHash?: string; agent?: string }): Promise<void>;
  succeed(id: string, summary: Record<string, unknown>): Promise<void>;
  /** `reason` must be redacted already. */
  fail(id: string, reason: string, summary?: Record<string, unknown>): Promise<void>;
  /** Records the run as cancelled (a person asked for it). */
  cancel(id: string): Promise<void>;
  /** Of the given runs, those a person asked to cancel. */
  cancelRequested(ids: readonly string[]): Promise<string[]>;
  /** Appends an event to a run's live record; must not throw for a failing write (best effort). */
  addEvent(event: JobEventRecord): Promise<void>;
  /** Stores the spans of an agent attempt; best effort like addEvent: a failing write never fails the run. */
  addSpans(spans: readonly SpanRecord[]): Promise<void>;
  addArtifacts(id: string, entries: readonly ArtifactEntry[]): Promise<void>;
  /** Stores one file of the run's restricted/ output, encrypted. */
  addRestricted(id: string, path: string, content: Buffer): Promise<void>;
  /** Records the document write (queued) and links it to the run. */
  recordDocumentWrite(id: string, request: DocumentWriteRequest): Promise<void>;
  /** The project's document repository. */
  documentRepository(projectId: string): Promise<string | undefined>;
  /** The provider/model bound to an agent: per project first, then the installation default. */
  modelBinding(agent: string, projectId: string): Promise<ModelBinding | undefined>;
}

/** Read-only checkouts of registered repositories at a fixed commit. */
export interface SourceCheckouts {
  /** Brings the mirror up to date and returns the commit `ref` (default: the default branch) points to. */
  resolve(repositoryId: string): Promise<string>;
  /** A detached worktree of `commit` at `dest`, marked read-only. */
  checkout(repositoryId: string, commit: string, dest: string): Promise<void>;
  /** A text file of the repository at `commit`; undefined when it does not exist. */
  readDocument(repositoryId: string, commit: string, path: string): Promise<string | undefined>;
  /** The files under folder `dir` (ending in "/") at `commit`, sorted; none when it does not exist. */
  listDocuments?(repositoryId: string, commit: string, dir: string): Promise<string[]>;
  /** Removes a worktree made by checkout(). */
  release(repositoryId: string, dest: string): Promise<void>;
}

/** A human decision a stage plan reaches (a `gate` step). */
export interface GateRequest {
  /** The stage run. */
  runId: string;
  projectId: string;
  applicationId?: string;
  stage: string;
  /** The gate step's id. */
  gate: string;
  question: string;
  options: readonly string[];
  /** The documented default, taken when nobody answers. */
  default: string;
}

export interface GateDecision {
  choice: string;
  /** True when the default was taken without a person's answer. */
  defaulted: boolean;
  by?: string;
}

/**
 * Decides gates. Persisted gates (portal tasks with a deadline) plug in here; until then the
 * default decider takes the documented default at once and the stage records it.
 */
export interface GateDecider {
  decide(request: GateRequest, signal?: AbortSignal): Promise<GateDecision>;
}

/** TODO(gates): replace with a decider backed by persisted gates once they exist. */
export const DEFAULT_GATE_DECIDER: GateDecider = {
  decide: async (request) => ({ choice: request.default, defaulted: true }),
};

/** The abort reason of a run a person cancelled (as opposed to the worker stopping). */
export class JobCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "JobCancelled";
  }
}

/** True when `signal` was aborted because the run was cancelled. */
export const isCancelled = (signal: AbortSignal | undefined): boolean => signal?.aborted === true && signal.reason instanceof JobCancelled;

/** A failure whose reason is safe to record and show (already redacted). */
export class JobFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobFailure";
  }
}
