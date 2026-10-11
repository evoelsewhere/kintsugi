// Typed access to installation-wide monitoring reads (Overview, Monitoring). Mirrors
// apps/api → modules/monitoring/overview and the cross-project lists of job runs and
// document writes. Reads need a session only.

import { apiGet, type Page } from "../api";
import { queryString } from "./job-runs";
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
  repositoriesNotReady: number;
}

export interface AttentionItem {
  kind: "run-failed" | "run-stuck" | "write-failed" | "repository-error";
  at: string;
  title: string;
  detail?: string;
  projectId?: string;
  applicationId?: string;
  jobRunId?: string;
  documentWriteId?: string;
  repositoryId?: string;
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

export interface WorkerHealth {
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

export type DocumentWriteStatus = DocumentWriteView["status"];

export const monitoringApi = {
  overview: () => apiGet<MonitoringOverview>("/api/monitoring/overview"),
  repositories: () => apiGet<MonitoredRepository[]>("/api/monitoring/repositories"),
  /** Document writes across projects, newest first. */
  documentWrites: (filter: { status?: DocumentWriteStatus[]; projectId?: string; limit?: number; offset?: number } = {}) =>
    apiGet<Page<DocumentWriteView>>(`/api/document-writes${queryString(filter)}`),
};
