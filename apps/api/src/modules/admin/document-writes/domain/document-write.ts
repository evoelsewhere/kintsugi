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
  /** Only writes of these projects (the caller's Project Access); absent means every project. */
  projectIds?: readonly string[];
}

/** The document and gap a correction answers (ADR-0094). */
export interface DocumentWriteCorrection {
  /** The specification, relative to the document repo root. */
  path: string;
  /** The gap id the answer settles or reopens. */
  gap: string;
}

/** What produced the files. */
/** `page` is a wiki page (or its attachment) published by a person (ADR-0098); the rest come from Kintsugi itself. */
export type DocumentWriteKind = "manifest" | "job-output" | "state-change" | "page";

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
  /** Set on a page write: the page it publishes. */
  page?: { path: string; id: string | null };
  /** The commit that brought the pull request into the default branch, once it is merged. */
  mergeCommit?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentWriteFile {
  /** Path relative to the document repo root, forward slashes. */
  path: string;
  /** The text, or the base64 of the bytes when `encoding` says so; empty for a delete. */
  content: string;
  /** How `content` is written: text (the default) or base64 for a binary file. */
  encoding?: "utf8" | "base64";
  /** Remove the file; `expectedHash` (the file as the person saw it) is then required. */
  delete?: true;
  /** Move the file from this path to `path` in the same commit; `expectedHash` is then that of the old file. */
  renameFrom?: string;
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
  /** Kind `page`: publish straight to the default branch when the manifest allows it for every path. */
  directPublish?: boolean;
  /** Kind `page`: the open `kintsugi/*` branch of the same person's earlier write of the page, which this one continues. */
  continues?: string;
  /** Kind `page`: the page this write publishes. */
  page?: { id: string | null; path: string; minor: boolean };
}

/** A correction is open until its pull request is merged or closed: queued, or on its review branch. */
export const isOpenCorrection = (write: Pick<DocumentWriteRecord, "status" | "branch" | "correction">): boolean =>
  write.correction !== undefined && (write.status === "queued" || (write.branch !== undefined && (write.status === "committed" || write.status === "pr-opened")));

/** A page write is open until its pull request is merged or closed: queued, or on its review branch (the SQL twin is in the store). */
export const isOpenPageWrite = (write: Pick<DocumentWriteRecord, "status" | "branch" | "page">): boolean =>
  write.page !== undefined && (write.status === "queued" || (write.branch !== undefined && (write.status === "committed" || write.status === "pr-opened")));

/** The number of a pull request (or merge request) from its web URL, when the URL carries one. */
export function pullRequestNumber(url: string | undefined): number | undefined {
  const match = url === undefined ? null : /\/(?:pull|pulls|merge_requests|pull-requests)\/(\d+)(?:[/?#]|$)/.exec(url);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}
