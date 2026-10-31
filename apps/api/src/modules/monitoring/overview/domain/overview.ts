// Domain of the monitoring overview: what the installation is doing right now, read from the
// records the API and the worker keep (projects, job runs, document writes, Git repositories)
// gates and worker heartbeats) and from the worker's job queue. Read-only; counts are of top-level runs (a stage, not its
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
  /** A worker seen within this many seconds is up (it beats every 15 s, ADR-0030). */
  workerUpSeconds: 45,
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
  /** Every registered repository (Settings -> Git), linked to a project or not. */
  repositories: number;
  repositoriesWithErrors: number;
  /** Registered repositories no project links. */
  repositoriesUnlinked: number;
  /** Of repositoriesWithErrors, those no project links. */
  repositoriesWithErrorsUnlinked: number;
  /** Repositories still pending or cloning. */
  repositoriesNotReady: number;
  /** Gates waiting for a decision. */
  pendingGates: number;
}

export type AttentionKind = "run-failed" | "run-stuck" | "write-failed" | "repository-error" | "gate-pending" | "worker-down";

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

/** Jobs of one worker queue. */
export interface QueueCount {
  name: string;
  queued: number;
  active: number;
  /** Queued with a start time still ahead (retries, throttled keys). */
  deferred: number;
}

/** up: seen within OVERVIEW_LIMITS.workerUpSeconds; stale: not seen since; stopped: shut down cleanly. */
export type WorkerState = "up" | "stale" | "stopped";

/** One worker process from its heartbeat (workflow.worker_heartbeat, ADR-0030). */
export interface WorkerStatus {
  workerId: string;
  host: string;
  pid: number;
  version: string;
  startedAt: string;
  lastSeenAt: string;
  stoppedAt?: string;
  /** Seconds since the last beat, by the database clock. */
  secondsSinceSeen: number;
  activeJobs: number;
  queues: string[];
  state: WorkerState;
}

export interface WorkerHealth {
  /** At least one worker is up. */
  up: boolean;
  /** Workers that are up. */
  workersUp: number;
  /** The latest beat of any worker. */
  lastSeenAt?: string;
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

/** A pending gate as the overview needs it. */
export interface PendingGateRecord {
  id: string;
  projectId: string;
  applicationId?: string;
  gateKey: string;
  title: string;
  requestedBy: string;
  /** requested_at. */
  at: string;
}

/** A heartbeat row; the use case derives the state. */
export type WorkerRecord = Omit<WorkerStatus, "state">;

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
