// services/orchestrator — the kintsugi-worker: pg-boss queues, Git sync and the document
// repo writer (ADR-0003, ADR-0019, ADR-0025).

export { DEFAULT_BOT_EMAIL, GIT_SYNC_QUEUE, QUEUE_SCHEMA, startWorker, type Worker, type WorkerOptions } from "./worker.js";
export {
  DOCUMENT_WRITE_QUEUE,
  DOCUMENT_WRITE_QUEUE_OPTIONS,
  ensureDocumentWriteQueue,
  sendDocumentWrite,
  type DocumentWriteFile,
  type DocumentWriteRequest,
} from "./queues.js";
export { RepositoryStore, type SyncStatus, type SyncTarget } from "./git-sync/repositories.js";
export { pruneMirrors, syncRepository, type SyncDeps, type SyncResult } from "./git-sync/sync.js";
export { DocumentWriteStore, type DocumentRepoTarget, type DocumentWriteOutcome, type DocumentWriteStatus } from "./document-write/store.js";
export { OUTPUT_LIMITS, OutputRuleError, readOutputDir, splitByAutoCommit, validateOutputs } from "./document-write/outputs.js";
export { writeDocument, writerBranch, writerTrailers, type WriterDeps } from "./document-write/writer.js";
