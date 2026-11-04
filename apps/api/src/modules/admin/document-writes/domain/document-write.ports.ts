// Ports of document writes — the DI tokens of this module: where writes are recorded
// (Postgres, workflow.document_write) and how they reach the worker (the job queue).

import type { DocumentWriteCorrection, DocumentWriteFile, DocumentWriteFilter, DocumentWriteRecord, NewDocumentWrite } from "./document-write.js";

/** What recording a correction did: recorded it, or found the open correction of the same document. */
export type CorrectionOutcome = { created: DocumentWriteRecord } | { open: DocumentWriteRecord };

export abstract class DocumentWriteStore {
  /** Records the write as `queued`. */
  abstract create(write: NewDocumentWrite): Promise<DocumentWriteRecord>;
  /** The project's writes, newest first, with the total count. */
  abstract listForProject(projectId: string, limit: number, offset: number): Promise<{ items: DocumentWriteRecord[]; total: number }>;
  /** Writes across projects, newest first, with the total count. */
  abstract list(filter: DocumentWriteFilter, limit: number, offset: number): Promise<{ items: DocumentWriteRecord[]; total: number }>;
  /**
   * Records a correction as `queued` unless an open correction of the same document exists; serialized per document,
   * so two answers sent at once cannot both pass.
   */
  abstract createCorrection(write: NewDocumentWrite & { correction: DocumentWriteCorrection }): Promise<CorrectionOutcome>;
  /** The project's open corrections (ADR-0094), newest first. */
  abstract openCorrections(projectId: string): Promise<DocumentWriteRecord[]>;
  /** One write by id; undefined when there is none. */
  abstract find(id: string): Promise<DocumentWriteRecord | undefined>;
  /** The write of the page that is queued, or committed or pull-request-opened on a review branch; undefined when there is none. */
  abstract openPageWrite(projectId: string, pagePath: string): Promise<DocumentWriteRecord | undefined>;
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
