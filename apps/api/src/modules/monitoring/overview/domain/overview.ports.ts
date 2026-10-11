// Ports of the monitoring overview — the DI tokens of this module: the read model over the
// installation's records (Postgres) and the health of the worker's job queues (pg-boss).

import type {
  MonitoredRepository,
  OverviewCounts,
  PendingGateRecord,
  QueueCount,
  RepositoryErrorRecord,
  RunRecord,
  StuckRunRecord,
  WorkerRecord,
  WorkerTimes,
  WriteRecord,
} from "./overview.js";

export abstract class MonitoringReadModel {
  abstract counts(): Promise<OverviewCounts>;
  /** Failed top-level runs finished within `days`, newest first. */
  abstract failedRuns(days: number, limit: number): Promise<RunRecord[]>;
  /** Top-level runs queued for longer than `minutes`, oldest first. */
  abstract stuckRuns(minutes: number, limit: number): Promise<StuckRunRecord[]>;
  /** Failed document writes updated within `days`, newest first. */
  abstract failedWrites(days: number, limit: number): Promise<WriteRecord[]>;
  /** Repositories whose last sync failed, newest first. */
  abstract repositoryErrors(limit: number): Promise<RepositoryErrorRecord[]>;
  /** The latest top-level runs, by their last change. */
  abstract recentRuns(limit: number): Promise<RunRecord[]>;
  /** The latest document writes, by their last change. */
  abstract recentWrites(limit: number): Promise<WriteRecord[]>;
  abstract workerTimes(): Promise<WorkerTimes>;
  /** Pending gates, oldest request first. */
  abstract pendingGates(limit: number): Promise<PendingGateRecord[]>;
  /** Every worker heartbeat row, the latest beat first. */
  abstract workers(): Promise<WorkerRecord[]>;
  /** Every registered repository with its project links, ordered by id. */
  abstract repositories(): Promise<MonitoredRepository[]>;
}

export abstract class QueueHealth {
  /** Job counts of the worker's queues; throws when the queue cannot be read. */
  abstract queues(): Promise<QueueCount[]>;
}
