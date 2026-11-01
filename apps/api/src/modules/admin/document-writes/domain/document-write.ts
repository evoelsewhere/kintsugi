// Domain of document writes (ADR-0019): a request to commit files to a project's document
// repo, performed by the worker's writer — the only component that commits to project repos.
// The API records the write as `queued` and enqueues it; the worker records the outcome.
// Pure types — no framework, no I/O.

export const DOCUMENT_WRITE_STATUSES = ["queued", "committed", "pr-opened", "merged", "closed", "unchanged", "failed"] as const;
export type DocumentWriteStatus = (typeof DOCUMENT_WRITE_STATUSES)[number];

/** Filter of the cross-project write list. */
export interface DocumentWriteFilter {
  statuses?: readonly DocumentWriteStatus[];
  projectId?: string;
}

/** The document and gap a correction answers (ADR-0094). */
export interface DocumentWriteCorrection {
  /** The specification, relative to the document repo root. */
  path: string;
  /** The gap id the answer settles or reopens. */
  gap: string;
}

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
  /** Set on a gap answer: the specification and gap it answers. */
  correction?: DocumentWriteCorrection;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentWriteFile {
  /** Path relative to the document repo root, forward slashes. */
  path: string;
  content: string;
  /** Written only when the default branch does not have the file yet. */
  createOnly?: boolean;
  /** SHA-256 of the document the person edited, checked by the writer before committing. */
  expectedHash?: string;
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
  /** Every file goes to one pull request, auto-commit paths included. */
  reviewAll?: boolean;
  actor?: string;
  /** Markdown for the pull request description, between the message and the file list. */
  description?: string;
  correction?: DocumentWriteCorrection;
}

/** A correction is open until its pull request is merged or closed: queued, or on its review branch. */
export const isOpenCorrection = (write: Pick<DocumentWriteRecord, "status" | "branch" | "correction">): boolean =>
  write.correction !== undefined && (write.status === "queued" || (write.branch !== undefined && (write.status === "committed" || write.status === "pr-opened")));

/** The number of a pull request (or merge request) from its web URL, when the URL carries one. */
export function pullRequestNumber(url: string | undefined): number | undefined {
  const match = url === undefined ? null : /\/(?:pull|pulls|merge_requests|pull-requests)\/(\d+)(?:[/?#]|$)/.exec(url);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}
