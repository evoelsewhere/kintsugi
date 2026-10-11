// Job runs (workflow.job_run, migration 010; ADR-0027, ADR-0029): what the worker records
// about every runtime step it runs, and the ports the job runner depends on. A stage is a
// sequence of steps; each step is a child run with its own job workspace.

import type { Provenance } from "@kintsugi/domain";
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
  sourceRepositoryId?: string;
  sourceCommit?: string;
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

/** Persistence of job runs and what they need to know about the project. */
export interface JobStore {
  get(id: string): Promise<JobRun | undefined>;
  create(run: NewJobRun): Promise<void>;
  /** queued → running; records the source commit once known. */
  start(id: string): Promise<void>;
  update(id: string, patch: { sourceCommit?: string; scriptHash?: string; agent?: string }): Promise<void>;
  succeed(id: string, summary: Record<string, unknown>): Promise<void>;
  /** `reason` must be redacted already. */
  fail(id: string, reason: string, summary?: Record<string, unknown>): Promise<void>;
  addArtifacts(id: string, entries: readonly ArtifactEntry[]): Promise<void>;
  /** Stores one file of the run's restricted/ output, encrypted. */
  addRestricted(id: string, path: string, content: Buffer): Promise<void>;
  /** Records the document write (queued) and links it to the run. */
  recordDocumentWrite(id: string, request: DocumentWriteRequest): Promise<void>;
  /** The application's legacy repository (the first one when there are several). */
  legacyRepository(projectId: string, applicationId: string): Promise<string | undefined>;
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
  /** Removes a worktree made by checkout(). */
  release(repositoryId: string, dest: string): Promise<void>;
}

/** A failure whose reason is safe to record and show (already redacted). */
export class JobFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobFailure";
  }
}
