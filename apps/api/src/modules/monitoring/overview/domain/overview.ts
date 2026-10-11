// Domain of the monitoring overview: what the installation is doing right now, read from the
// records the API and the worker keep (projects, job runs, document writes, Git repositories)
// and from the worker's job queue. Read-only; counts are of top-level runs (a stage, not its
// steps). Pure types and constants.

/** Look-back windows and limits of the overview. */
export const OVERVIEW_LIMITS = {
  /** Items in the attention list and in the activity feed. */
  attention: 20,
  activity: 20,
  /** Failed runs and writes stay in the attention list this long. */
  attentionDays: 7,
  /** A run still queued after this long has not been picked up by the worker. */
  stuckAfterMinutes: 10,
} as const;

export interface OverviewCounts {
  projects: number;
  applications: number;
  /** queuedRuns + runningRuns. */
  activeRuns: number;
  queuedRuns: number;
  runningRuns: number;
  failedRuns24h: number;
  succeededRuns24h: number;
  /** Document writes waiting for the worker's writer. */
  pendingWrites: number;
  /** Writes that opened a pull request in the last 7 days. */
  pullRequests7d: number;
  failedWrites24h: number;
  repositories: number;
  repositoriesWithErrors: number;
  /** Repositories still pending or cloning. */
  repositoriesNotReady: number;
}

export type AttentionKind = "run-failed" | "run-stuck" | "write-failed" | "repository-error";

export interface AttentionItem {
  kind: AttentionKind;
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

/** Jobs of one worker queue. */
export interface QueueCount {
  name: string;
  queued: number;
  active: number;
  /** Queued with a start time still ahead (retries, throttled keys). */
  deferred: number;
}

export interface WorkerHealth {
  /** null when the queue could not be read. */
  queues: QueueCount[] | null;
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

// Records the read model returns; the use case turns them into attention and activity items.

/** A top-level run as the overview needs it. */
export interface RunRecord {
  id: string;
  projectId: string;
  applicationId?: string;
  name: string;
  status: string;
  failureReason?: string;
  actor?: string;
  /** finished_at, else started_at, else created_at. */
  at: string;
}

/** A run still queued, and for how long (minutes, by the database clock). */
export interface StuckRunRecord extends RunRecord {
  queuedMinutes: number;
}

export interface WriteRecord {
  id: string;
  projectId: string;
  /** The application of the run that produced it, when there is one. */
  applicationId?: string;
  status: string;
  message: string;
  error?: string;
  actor?: string;
  prUrl?: string;
  branch?: string;
  /** updated_at. */
  at: string;
}

export interface RepositoryErrorRecord {
  id: string;
  lastError?: string;
  at: string;
}

export interface WorkerTimes {
  lastGitSyncAt?: string;
  oldestQueuedRunAt?: string;
}

export type RepositorySyncStatus = "pending" | "cloning" | "ready" | "error";

/** Where a repository is used. */
export interface RepositoryLink {
  projectId: string;
  role: string;
  applicationId?: string;
  component?: string;
}

/** A registered repository with its sync state and its project links; never a credential. */
export interface MonitoredRepository {
  id: string;
  serverId: string;
  url: string;
  defaultBranch?: string;
  syncStatus: RepositorySyncStatus;
  lastCommit?: string;
  lastSyncedAt?: string;
  lastError?: string;
  projects: RepositoryLink[];
}
