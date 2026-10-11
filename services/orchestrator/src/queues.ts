// Queue contract of the kintsugi-worker (ADR-0003): queue names, their options and payloads.
// Producers outside the worker (the API) import this module only — `@kintsugi/orchestrator/queues` —
// so both sides create and fill each queue the same way.

import type { PgBoss } from "pg-boss";

/** pg-boss owns this schema (an infrastructure library, not a domain schema). */
export const QUEUE_SCHEMA = "pgboss";

/** Mirror clone/fetch of one registered repository; singletonKey = repository id. */
export const GIT_SYNC_QUEUE = "git-sync";

/**
 * Writes to a project's document repo (ADR-0019); singletonKey = document repository id.
 * The `singleton` policy runs one write per repository at a time and queues the rest.
 */
export const DOCUMENT_WRITE_QUEUE = "document-write";

/**
 * Runs one runtime job run (workflow.job_run, migration 010): a stage, script, agent job or
 * workflow, in its job workspace (ADR-0029). Not retried: a job that failed half-way is
 * re-run by a person, as a new run.
 */
export const JOB_RUN_QUEUE = "job-run";

type QueueOptions = NonNullable<Parameters<PgBoss["createQueue"]>[1]>;

export const DOCUMENT_WRITE_QUEUE_OPTIONS: QueueOptions = {
  policy: "singleton",
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 30 * 60,
};

export const JOB_RUN_QUEUE_OPTIONS: QueueOptions = {
  policy: "standard",
  retryLimit: 0,
  expireInSeconds: 4 * 60 * 60,
};

/** Payload of a `job-run` job; the API creates the row as `queued` first. */
export interface JobRunRequest {
  jobRunId: string;
}

/** One file of a write; `base64` carries binary content. */
export interface DocumentWriteFile {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

/**
 * Payload of a `document-write` job. The files come inline (`files`) or from a finished
 * runtime job's output directory (`outputOfJob`: <data>/jobs/<job-id>/out). Provenance fields
 * become commit trailers (docs/reference/document-repo.md#commit-conventions).
 */
export interface DocumentWriteRequest {
  /** Row id in workflow.document_write; the API creates the row as `queued`. */
  writeId: string;
  projectId: string;
  /** What produced the files: `manifest`, `job-output`, `state-change`, … */
  kind: string;
  /** Commit message (first line = pull-request title). */
  message: string;
  files?: DocumentWriteFile[];
  outputOfJob?: string;
  /** Kintsugi-Actor: the user on whose behalf Kintsugi writes. */
  actor?: string;
  /** Kintsugi-Job: the runtime job id. */
  jobId?: string;
  /** Kintsugi-Agent: `<agent>@<version>`. */
  agent?: string;
  /** Kintsugi-Unit: the work item a state change belongs to. */
  unit?: string;
}

/** Creates the queue if missing; safe on every start, from any process. */
export async function ensureDocumentWriteQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(DOCUMENT_WRITE_QUEUE, DOCUMENT_WRITE_QUEUE_OPTIONS);
}

/** Enqueues a write behind any other write to the same document repository. */
export async function sendDocumentWrite(boss: PgBoss, documentRepositoryId: string, request: DocumentWriteRequest): Promise<void> {
  await boss.send(DOCUMENT_WRITE_QUEUE, request, { singletonKey: documentRepositoryId });
}

/** Creates the job-run queue if missing; safe on every start, from any process. */
export async function ensureJobRunQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(JOB_RUN_QUEUE, JOB_RUN_QUEUE_OPTIONS);
}

/** Enqueues a job run for the worker. */
export async function sendJobRun(boss: PgBoss, request: JobRunRequest): Promise<void> {
  await boss.send(JOB_RUN_QUEUE, request);
}
