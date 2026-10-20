// Ports of document writes — the DI tokens of this module: where writes are recorded
// (Postgres, workflow.document_write) and how they reach the worker (the job queue).

import type { DocumentWriteFile, DocumentWriteFilter, DocumentWriteRecord, NewDocumentWrite } from "./document-write.js";

export abstract class DocumentWriteStore {
  /** Records the write as `queued`. */
  abstract create(write: NewDocumentWrite): Promise<DocumentWriteRecord>;
  /** The project's writes, newest first, with the total count. */
  abstract listForProject(projectId: string, limit: number, offset: number): Promise<{ items: DocumentWriteRecord[]; total: number }>;
  /** Writes across projects, newest first, with the total count. */
  abstract list(filter: DocumentWriteFilter, limit: number, offset: number): Promise<{ items: DocumentWriteRecord[]; total: number }>;
  /** Marks a write failed before it reached the worker. */
  abstract markFailed(id: string, error: string): Promise<void>;
}

/** The starter structure of a document repo (templates/document-repo), made for a set of applications. */
export abstract class DocumentRepoSkeleton {
  /** Create-only files: the project-level folders once, and the per-application folders for each application id. */
  abstract files(applicationIds: readonly string[]): Promise<DocumentWriteFile[]>;
}

export abstract class DocumentWriteQueue {
  /** Hands the write to the worker's writer, behind other writes to the same document repository. */
  abstract enqueue(write: NewDocumentWrite): Promise<void>;
}
