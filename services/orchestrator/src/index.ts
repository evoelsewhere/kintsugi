// services/orchestrator — the kintsugi-worker: pg-boss queues, Git sync, the document repo
// writer and runtime job runs in job workspaces (ADR-0003, ADR-0019, ADR-0025, ADR-0029).

export { GIT_SYNC_QUEUE, QUEUE_SCHEMA, startWorker, type Worker, type WorkerOptions } from "./worker.js";
export {
  DOCUMENT_WRITE_QUEUE,
  DOCUMENT_WRITE_QUEUE_OPTIONS,
  JOB_RUN_QUEUE,
  JOB_RUN_QUEUE_OPTIONS,
  SNAPSHOT_RETENTION_QUEUE,
  SNAPSHOT_RETENTION_QUEUE_OPTIONS,
  ensureDocumentWriteQueue,
  ensureJobRunQueue,
  ensureSnapshotRetentionQueue,
  sendDocumentWrite,
  sendJobRun,
  type DocumentWriteFile,
  type DocumentWriteRequest,
  type JobRunRequest,
  type SnapshotRetentionRequest,
} from "./queues.js";
export { RepositoryStore, type SyncStatus, type SyncTarget } from "./git-sync/repositories.js";
export { pruneMirrors, syncRepository, withMirrorLock, type SyncDeps, type SyncResult } from "./git-sync/sync.js";
export { DocumentWriteStore, type DocumentRepoTarget, type DocumentWriteOutcome, type DocumentWriteStatus } from "./document-write/store.js";
export { OUTPUT_LIMITS, OutputRuleError, readOutputDir, splitByAutoCommit, validateOutputs } from "./document-write/outputs.js";
export { writeDocument, writerBranch, writerTrailers, type WriterDeps } from "./document-write/writer.js";
export { DEFAULT_JOB_LIMITS, JobRunner, type JobDefaults, type JobRunnerDeps, type StageBudgets } from "./jobs/runner.js";
export { PgJobStore } from "./jobs/store.js";
export { MirrorCheckouts } from "./jobs/checkouts.js";
export { builtinAgents, installedAgents, pgCustomAgents, type AgentResolver } from "./jobs/agents.js";
export { JOB_OUTPUT_HOOK, runJobOutputHook, type HookOutcome } from "./jobs/hook.js";
export { STAGES, STAGE_IDS, fill, stageInfo, type StageInfo, type StagePlan, type StagePrerequisite, type StageStep } from "./jobs/stages.js";
export { StagePlanExecutor, type ExecutorDeps, type StageOutcome } from "./jobs/executor.js";
export { loadWorkflow, runWorkflow, workflowBody, type WorkflowBudgets, type WorkflowOutcome } from "./jobs/workflow.js";
export { DEFAULT_GATE_DECIDER, JobFailure, type GateDecider, type GateDecision, type GateRequest, type GateDecisionMode, type ArtifactEntry, type JobKind, type JobRun, type JobStatus, type JobStore, type NewJobRun, type SourceCheckouts, type StepLimits } from "./jobs/model.js";
export { createPersistedGateDecider, readStageDecision, recordStageDecision, StageDecisionConflict, StageDecisionNotFound, type PersistedGateDeciderDeps, type StageDecisionDb, type StageDecisionRecord, type StageDecisionSubmission } from "./jobs/persisted-gate-decider.js";
export { WORKER_ACTOR, gateState, requestGate, waitForGate, type GateDb, type GateRequest as PersistedGateRequest, type GateState, type WaitOptions } from "./gates.js";
