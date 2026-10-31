// Typed access to installation-wide monitoring reads (Overview, Monitoring). Mirrors
// apps/api → modules/monitoring/overview and the cross-project lists of job runs and
// document writes. Reads need a session only.

import { apiGet, apiSend, type Page } from "../api";
import { queryString } from "./job-runs";
import type { GateStatus, ItemStatus, Phase } from "@kintsugi/domain";
import type { DocumentWriteView } from "./projects";

export interface OverviewCounts {
  projects: number;
  applications: number;
  activeRuns: number;
  queuedRuns: number;
  runningRuns: number;
  failedRuns24h: number;
  succeededRuns24h: number;
  pendingWrites: number;
  pullRequests7d: number;
  failedWrites24h: number;
  repositories: number;
  repositoriesWithErrors: number;
  /** Registered repositories no project links. */
  repositoriesUnlinked: number;
  /** Of repositoriesWithErrors, those no project links. */
  repositoriesWithErrorsUnlinked: number;
  repositoriesNotReady: number;
  /** Gates waiting for a decision. */
  pendingGates: number;
}

export interface AttentionItem {
  kind: "run-failed" | "run-stuck" | "write-failed" | "repository-error" | "gate-pending" | "worker-down";
  at: string;
  title: string;
  detail?: string;
  projectId?: string;
  applicationId?: string;
  jobRunId?: string;
  documentWriteId?: string;
  repositoryId?: string;
  gateId?: string;
}

export interface ActivityItem {
  kind: "run" | "write";
  at: string;
  status: string;
  title: string;
  projectId: string;
  applicationId?: string;
  jobRunId?: string;
  documentWriteId?: string;
  actor?: string;
  prUrl?: string;
  branch?: string;
}

export interface QueueHealth {
  name: string;
  queued: number;
  active: number;
  deferred: number;
}

/** up: seen within 45 s; stale: not seen since; stopped: shut down cleanly. */
export type WorkerState = "up" | "stale" | "stopped";

/** One worker process from its heartbeat (ADR-0030). */
export interface WorkerStatus {
  workerId: string;
  host: string;
  pid: number;
  version: string;
  startedAt: string;
  lastSeenAt: string;
  stoppedAt?: string;
  secondsSinceSeen: number;
  activeJobs: number;
  queues: string[];
  state: WorkerState;
}

export interface WorkerHealth {
  /** At least one worker sent a heartbeat in the last 45 s. */
  up: boolean;
  workersUp: number;
  /** The latest heartbeat of any worker. */
  lastSeenAt?: string;
  /** Null when the queue counts could not be read. */
  queues: QueueHealth[] | null;
  lastGitSyncAt?: string;
  oldestQueuedRunAt?: string;
}

export interface MonitoringOverview {
  generatedAt: string;
  counts: OverviewCounts;
  attention: AttentionItem[];
  activity: ActivityItem[];
  worker: WorkerHealth;
}

export interface MonitoredRepository {
  id: string;
  serverId: string;
  url: string;
  defaultBranch?: string;
  syncStatus: "pending" | "cloning" | "ready" | "error";
  lastCommit?: string;
  lastSyncedAt?: string;
  lastError?: string;
  projects: Array<{ projectId: string; role: string; applicationId?: string; component?: string }>;
}

/** Mirrors apps/api → modules/monitoring/portfolio: where each application stands and what a person decides next. */
export interface PortfolioGate {
  key: string;
  status: GateStatus | "not-requested";
  gateId?: string;
  requestedAt?: string;
}

export interface PortfolioApplication {
  projectId: string;
  projectName: string;
  applicationId: string;
  applicationName: string;
  phase: Phase;
  gate: PortfolioGate | null;
  assess: { sloc: number; sourceFiles: number; complexityIndex: number; critical: number; high: number; securityFindings: number; outlook?: string } | null;
  catalog: { total: number; understood: number; counts: Partial<Record<ItemStatus, number>> } | null;
  blocked?: string;
  lastRunAt?: string;
}

export interface PortfolioDecision {
  kind: "gate" | "pull-request" | "findings";
  at: string;
  title: string;
  detail?: string;
  projectId: string;
  applicationId?: string;
  gateId?: string;
  documentWriteId?: string;
  prUrl?: string;
}

export interface PortfolioUnit {
  projectId: string;
  applicationId: string;
  id: string;
  name: string;
  module: string;
  complexity: "low" | "medium" | "high";
  loc: number;
  status: ItemStatus;
}

export interface PortfolioOverview {
  generatedAt: string;
  applications: PortfolioApplication[];
  decisions: PortfolioDecision[];
  funnel: { total: number; counts: Partial<Record<ItemStatus, number>> };
  riskiest: PortfolioUnit[];
}

export type DocumentWriteStatus = DocumentWriteView["status"];

/** A job workspace on the worker's data volume with the run behind it (ADR-0058). */
export interface SandboxWorkspace {
  jobId: string;
  modifiedAt: string;
  lifecycle?: "running" | "parked" | "published";
  attempt?: number;
  /** `<role>:<repository id>@<short commit>` of what it mounts. */
  sources: string[];
  hasCheckouts: boolean;
  /** Bytes of what a retry cannot make again; `resultsBytesTruncated`: the real size is larger. */
  resultsBytes?: number;
  resultsBytesTruncated?: boolean;
  run?: { projectId: string; applicationId?: string; kind: string; name: string; status: string; attempt: number; createdAt: string; finishedAt?: string; writeStatus?: string };
  /** When the sweep removes it; absent while it is needed. */
  removalAt?: string;
  /** Why it cannot be removed now. */
  blockedBy?: string;
}

export interface SandboxWorkspaces {
  workspaces: SandboxWorkspace[];
  retentionDays: number;
}

export const monitoringApi = {
  overview: () => apiGet<MonitoringOverview>("/api/monitoring/overview"),
  portfolio: () => apiGet<PortfolioOverview>("/api/monitoring/portfolio"),
  repositories: () => apiGet<MonitoredRepository[]>("/api/monitoring/repositories"),
  sandboxWorkspaces: () => apiGet<SandboxWorkspaces>("/api/monitoring/sandbox/workspaces"),
  /** Asks the worker to remove one workspace (sandbox.manage); refused while its run is active or its write pending. */
  removeSandboxWorkspace: (jobId: string) => apiSend<{ jobId: string; status: "queued" }>(`/api/monitoring/sandbox/workspaces/${encodeURIComponent(jobId)}`, "DELETE"),
  /** Worker processes from their heartbeats, the latest beat first. */
  workers: () => apiGet<WorkerStatus[]>("/api/monitoring/workers"),
  /** Document writes across projects, newest first. */
  documentWrites: (filter: { status?: DocumentWriteStatus[]; projectId?: string; limit?: number; offset?: number } = {}) =>
    apiGet<Page<DocumentWriteView>>(`/api/document-writes${queryString(filter)}`),
};
