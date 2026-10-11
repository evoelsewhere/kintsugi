// Domain of document writes (ADR-0019): a request to commit files to a project's document
// repo, performed by the worker's writer — the only component that commits to project repos.
// The API records the write as `queued` and enqueues it; the worker records the outcome.
// Pure types — no framework, no I/O.

export type DocumentWriteStatus = "queued" | "committed" | "pr-opened" | "unchanged" | "failed";

/** What produced the files. */
export type DocumentWriteKind = "manifest" | "job-output" | "state-change";

export interface DocumentWriteRecord {
  id: string;
  projectId: string;
  kind: string;
  status: DocumentWriteStatus;
  /** Commit message; its first line is the pull-request title. */
  message: string;
  /** Commit on the default branch (auto-commit paths). */
  commit?: string;
  /** The `kintsugi/*` branch holding the reviewed paths, its tip and the pull request. */
  branch?: string;
  branchCommit?: string;
  prUrl?: string;
  /** Redacted failure reason. */
  error?: string;
  actor?: string;
  jobId?: string;
  agent?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentWriteFile {
  /** Path relative to the document repo root, forward slashes. */
  path: string;
  content: string;
}

/** A write to enqueue: the files plus the provenance that becomes commit trailers. */
export interface NewDocumentWrite {
  id: string;
  projectId: string;
  /** Serializes writes: one at a time per document repository. */
  documentRepositoryId: string;
  kind: DocumentWriteKind;
  message: string;
  files: DocumentWriteFile[];
  actor?: string;
}
