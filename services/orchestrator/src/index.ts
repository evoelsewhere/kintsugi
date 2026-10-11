// services/orchestrator — the kintsugi-worker: pg-boss queues, Git sync, the document repo
// writer and runtime job runs in job workspaces (ADR-0003, ADR-0019, ADR-0025, ADR-0029).

export { DEFAULT_BOT_EMAIL, GIT_SYNC_QUEUE, QUEUE_SCHEMA, startWorker, type Worker, type WorkerOptions } from "./worker.js";
export {
  DOCUMENT_WRITE_QUEUE,
  DOCUMENT_WRITE_QUEUE_OPTIONS,
  JOB_RUN_QUEUE,
  JOB_RUN_QUEUE_OPTIONS,
  ensureDocumentWriteQueue,
  ensureJobRunQueue,
  sendDocumentWrite,
  sendJobRun,
  type DocumentWriteFile,
  type DocumentWriteRequest,
  type JobRunRequest,
} from "./queues.js";
export { RepositoryStore, type SyncStatus, type SyncTarget } from "./git-sync/repositories.js";
export { pruneMirrors, syncRepository, type SyncDeps, type SyncResult } from "./git-sync/sync.js";
export { DocumentWriteStore, type DocumentRepoTarget, type DocumentWriteOutcome, type DocumentWriteStatus } from "./document-write/store.js";
export { OUTPUT_LIMITS, OutputRuleError, readOutputDir, splitByAutoCommit, validateOutputs } from "./document-write/outputs.js";
export { writeDocument, writerBranch, writerTrailers, type WriterDeps } from "./document-write/writer.js";
export { DEFAULT_JOB_LIMITS, JobRunner, type JobDefaults, type JobRunnerDeps } from "./jobs/runner.js";
export { PgJobStore } from "./jobs/store.js";
export { MirrorCheckouts } from "./jobs/checkouts.js";
export { builtinAgents, installedAgents, pgCustomAgents, type AgentResolver } from "./jobs/agents.js";
export { JOB_OUTPUT_HOOK, runJobOutputHook, type HookOutcome } from "./jobs/hook.js";
export { STAGES, STAGE_IDS, fill, type StagePlan, type StageStep } from "./jobs/stages.js";
export { WORKFLOWS_DIR, loadWorkflow, runWorkflow, workflowBody, type WorkflowBudgets, type WorkflowOutcome } from "./jobs/workflow.js";
export { JobFailure, type ArtifactEntry, type JobKind, type JobRun, type JobStatus, type JobStore, type NewJobRun, type SourceCheckouts, type StepLimits } from "./jobs/model.js";
