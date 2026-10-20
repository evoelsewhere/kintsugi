// The kintsugi-worker process core (ADR-0003, ADR-0019, ADR-0025, ADR-0029): pg-boss queues
// for Git sync, document writes and runtime job runs, plus the scheduler that feeds Git sync. New repositories are
// picked up within seconds; every repository is re-synced each poll interval; removed ones
// lose their mirror. Document writes run one at a time per document repository.

import { randomUUID } from "node:crypto";
import { CheckoutStorage } from "@kintsugi/git";
import { type Interpreters, interpretersFromEnv } from "@kintsugi/runtime/launcher";
import type { AgentRuntime } from "@kintsugi/runtime-sdk";
import { PgBoss } from "pg-boss";
import { Pool } from "pg";
import { DocumentWriteStore } from "./document-write/store.js";
import { startHeartbeat } from "./heartbeat.js";
import { failOrphanedRuns } from "./orphans.js";
import { watchPullRequests } from "./document-write/watch.js";
import { writeDocument } from "./document-write/writer.js";
import { RepositoryStore } from "./git-sync/repositories.js";
import { installedAgents } from "./jobs/agents.js";
import { DEFAULT_JOB_RETENTION_DAYS, pruneJobWorkspaces, removeJobWorkspace } from "./jobs/cleanup.js";
import { MirrorCheckouts } from "./jobs/checkouts.js";
import { type JobDefaults, JobRunner } from "./jobs/runner.js";
import { JobCancelled } from "./jobs/model.js";
import { PgJobStore } from "./jobs/store.js";
import { onDefaultTipMove, pruneMirrors, syncRepository } from "./git-sync/sync.js";
import { triggerRebuilds } from "./aggregates.js";
import { dispatchOutbox, PostgresOutboxStore } from "./outbox/index.js";
import { GitSnapshotPins, pruneExpiredSnapshots, recoverStaleSnapshots, retainSnapshot } from "./git-sync/retention.js";
import { PostgresSnapshotRetentionRepository } from "./git-sync/retention-store.js";
import {
  DOCUMENT_WRITE_QUEUE,
  type DocumentWriteRequest,
  GIT_SYNC_QUEUE,
  JOB_RUN_QUEUE,
  SNAPSHOT_RETENTION_QUEUE,
  type JobRunRequest,
  type SnapshotRetentionRequest,
  QUEUE_SCHEMA,
  ensureDocumentWriteQueue,
  ensureJobRunQueue,
  ensureSnapshotRetentionQueue,
  sendDocumentWrite,
  sendJobRun,
} from "./queues.js";

export { GIT_SYNC_QUEUE, QUEUE_SCHEMA } from "./queues.js";

export interface WorkerOptions {
  databaseUrl: string;
  pool: Pool;
  storage: CheckoutStorage;
  /** Seconds between full re-syncs of every repository (KINTSUGI_GIT_POLL_INTERVAL). */
  pollIntervalSeconds: number;
  /** Seconds between scans for newly registered (pending) repositories. */
  pendingScanSeconds?: number;
  /** Parallel syncs in this process. */
  concurrency?: number;
  /** For tests: the HTTP client of the pull-request adapters. */
  fetch?: typeof fetch;
  log?: (message: string) => void;
  /** Days the output of a failed run or write is kept (KINTSUGI_JOB_RETENTION_DAYS, default 7). */
  jobRetentionDays?: number;
  /** Seconds between looks at pull requests awaiting review, to record a merge or a close (default 60). */
  reviewWatchSeconds?: number;
  /** Seconds between sweeps of expired job workspaces (default: hourly). */
  cleanupIntervalSeconds?: number;
  /** Seconds between checks for cancel requests of the runs this worker runs (default 2). */
  cancelPollSeconds?: number;
  /** Seconds between heartbeats in workflow.worker_heartbeat (ADR-0030, default 15). */
  heartbeatSeconds?: number;
  /** Seconds between scans for durable member queue intents (default 1). */
  outboxScanSeconds?: number;
  /** Seconds between snapshot pin expiry sweeps (default: hourly). */
  snapshotCleanupSeconds?: number;
  /** Seconds between recovery scans for exhausted snapshot retention jobs (default: 60). */
  snapshotRecoverySeconds?: number;
  /** Runtime jobs (queue `job-run`); omitted = this worker runs no jobs. */
  jobs?: {
    /** pi in production; the mock backend in tests and mock-mode development. */
    agents: AgentRuntime;
    interpreters?: Interpreters;
    defaults?: JobDefaults;
    /** Parallel job runs in this process (KINTSUGI_JOB_MAX_CONCURRENCY). */
    concurrency?: number;
  };
}

export interface Worker {
  /** This process's id in workflow.worker_heartbeat. */
  readonly workerId: string;
  /** Enqueues a sync; deduplicated per repository (one queued and one running at most). */
  requestSync(repositoryId: string): Promise<void>;
  /** Enqueues a document write behind other writes to the same document repository. */
  requestWrite(documentRepositoryId: string, request: DocumentWriteRequest): Promise<void>;
  /** Enqueues a job run (the row must exist as `queued`). */
  requestJobRun(request: JobRunRequest): Promise<void>;
  stop(): Promise<void>;
}

export async function startWorker(options: WorkerOptions): Promise<Worker> {
  const log = options.log ?? ((message: string) => console.log(`[worker] ${message}`));
  const store = new RepositoryStore(options.pool);
  const jobStore = new PgJobStore(options.pool);
  const deps = { store, storage: options.storage };
  const writerDeps = {
    writes: new DocumentWriteStore(options.pool, store),
    repositories: store,
    storage: options.storage,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
  await options.storage.prepare();
  await failOrphanedRuns(options.pool, log);

  // Jobs in progress in this process (every queue), reported by the heartbeat.
  let busy = 0;
  const counted =
    <A extends unknown[]>(handler: (...args: A) => Promise<void>) =>
    async (...args: A): Promise<void> => {
      busy += 1;
      try {
        await handler(...args);
      } finally {
        busy -= 1;
      }
    };

  const boss = new PgBoss({ connectionString: options.databaseUrl, schema: QUEUE_SCHEMA });
  boss.on("error", (error) => log(`queue error: ${error.message}`));
  await boss.start();
  await boss.createQueue(GIT_SYNC_QUEUE, {
    // One queued and one active job per repository (singletonKey = repository id).
    policy: "stately",
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 60 * 60,
  });
  await ensureDocumentWriteQueue(boss);
  await ensureSnapshotRetentionQueue(boss);
  // Mirror owners use options.pool before releasing their lock. Retention sessions must
  // use separate capacity while waiting for that mirror, or the two locks can deadlock.
  const retentionConcurrency = 2;
  const retentionPool = new Pool({
    connectionString: options.databaseUrl,
    application_name: "kintsugi-snapshot-retention",
    max: retentionConcurrency,
  });
  retentionPool.on("error", (error) => log(`snapshot retention pool error: ${error.message}`));
  const retentionOperations = new Set<Promise<unknown>>();
  const trackRetention = async <T>(work: () => Promise<T>): Promise<T> => {
    const operation = work();
    retentionOperations.add(operation);
    try {
      return await operation;
    } finally {
      retentionOperations.delete(operation);
    }
  };
  const retentionRepository = new PostgresSnapshotRetentionRepository(options.pool, retentionPool);
  const retentionDependencies = {
    repository: retentionRepository,
    pins: new GitSnapshotPins(options.storage),
  };
  await boss.work<SnapshotRetentionRequest>(SNAPSHOT_RETENTION_QUEUE, { localConcurrency: retentionConcurrency }, counted(async ([job]) => {
    if (job === undefined) return;
    if (typeof job.data.snapshotId !== "string") throw new TypeError("snapshot retention payload is invalid");
    const result = await trackRetention(() => retainSnapshot(retentionDependencies, job.data.snapshotId));
    log("snapshot " + job.data.snapshotId + ": " + result.status);
  }));

  await boss.work<{ repositoryId: string }>(GIT_SYNC_QUEUE, { localConcurrency: options.concurrency ?? 2 }, counted(async ([job]) => {
    if (job === undefined) return;
    const result = await syncRepository(deps, job.data.repositoryId);
    if (result !== undefined) log(`${result.cloned ? "cloned" : "fetched"} ${result.repositoryId} at ${result.commit.slice(0, 12)}`);
  }));

  // One active write per document repository (singleton policy); different repositories in parallel.
  await boss.work<DocumentWriteRequest>(DOCUMENT_WRITE_QUEUE, { localConcurrency: options.concurrency ?? 2 }, counted(async ([job]) => {
    if (job === undefined) return;
    try {
      const outcome = await writeDocument(writerDeps, job.data);
      // The job's output has landed (or was already there): its workspace is no longer needed.
      if (job.data.outputOfJob !== undefined && outcome.status !== "failed") {
        await removeJobWorkspace(options.storage, job.data.outputOfJob).catch((error: unknown) =>
          log(`could not remove the workspace of job ${job.data.outputOfJob}: ${error instanceof Error ? error.message : String(error)}`),
        );
      }
      log(`document write ${job.data.writeId} (${job.data.projectId}): ${outcome.status}${"error" in outcome ? ` — ${outcome.error}` : ""}`);
    } catch (error) {
      log(`document write ${job.data.writeId} (${job.data.projectId}) failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }));

  const requestWrite = (documentRepositoryId: string, request: DocumentWriteRequest): Promise<void> => sendDocumentWrite(boss, documentRepositoryId, request);

  // Runtime jobs: one job workspace per run (ADR-0029); aborted when the worker stops.
  const stopping = new AbortController();
  const active = new Map<string, AbortController>();
  await ensureJobRunQueue(boss);
  if (options.jobs !== undefined) {
    const runner = new JobRunner({
      store: jobStore,
      storage: options.storage,
      checkouts: new MirrorCheckouts({ repositories: store, storage: options.storage }),
      agents: options.jobs.agents,
      agentDefinitions: installedAgents({ pool: options.pool }),
      interpreters: options.jobs.interpreters ?? interpretersFromEnv(),
      ...(options.jobs.defaults === undefined ? {} : { defaults: options.jobs.defaults }),
      requestWrite,
      log,
    });
    await boss.work<JobRunRequest>(JOB_RUN_QUEUE, { localConcurrency: options.jobs.concurrency ?? 2 }, counted(async ([job]) => {
      if (job === undefined) return;
      // One controller per run: a cancel request aborts this run only (its processes are killed).
      const cancel = new AbortController();
      active.set(job.data.jobRunId, cancel);
      try {
        await runner.run(job.data.jobRunId, AbortSignal.any([stopping.signal, cancel.signal]));
      } finally {
        active.delete(job.data.jobRunId);
      }
    }));
  }
  const watchCancels = async (): Promise<void> => {
    if (active.size === 0) return;
    for (const id of await jobStore.cancelRequested([...active.keys()])) active.get(id)?.abort(new JobCancelled());
  };

  // The aggregate rebuild (ADR-0033): a document repository whose default branch moved and touched
  // an application's items gets a rebuild run, which only a worker with runtime jobs can run.
  const stopRebuilds =
    options.jobs === undefined
      ? () => undefined
      : onDefaultTipMove(async (move) => {
          await triggerRebuilds({ pool: options.pool, enqueue: (jobRunId) => sendJobRun(boss, { jobRunId }), log }, move);
        });

  const requestSync = async (repositoryId: string): Promise<void> => {
    await boss.send(GIT_SYNC_QUEUE, { repositoryId }, { singletonKey: repositoryId });
  };

  // Scheduler: each tick is independent; a failed tick is logged and the next one retries.
  let stopped = false;
  const backgroundTicks = new Map<string, Promise<void>>();
  const tick = (name: string, work: () => Promise<void>) => (): Promise<void> => {
    if (stopped) return Promise.resolve();
    const previous = backgroundTicks.get(name);
    if (previous !== undefined) return previous;
    const operation = (async () => {
      try {
        await work();
      } catch (error) {
        log(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    backgroundTicks.set(name, operation);
    const finished = () => { backgroundTicks.delete(name); };
    void operation.then(finished, finished);
    return operation;
  };
  const scanPending = tick("pending scan", async () => {
    for (const id of await store.ids("pending")) await requestSync(id);
  });
  const pollAll = tick("poll", async () => {
    for (const id of await store.ids()) await requestSync(id);
    for (const key of await pruneMirrors(deps)) log(`pruned mirror ${key}`);
  });
  const watchReviews = tick("review watch", async () => {
    const outcome = await watchPullRequests({ ...writerDeps, log });
    if (outcome.merged.length + outcome.closed.length > 0) log(`review watch: ${outcome.merged.length} merged, ${outcome.closed.length} closed`);
  });
  const retentionMs = (options.jobRetentionDays ?? DEFAULT_JOB_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
  const checkCancels = tick("cancel check", watchCancels);
  const outboxStore = new PostgresOutboxStore(options.pool);
  const outboxWorkerId = randomUUID();
  const dispatchMemberOutbox = tick("member outbox", async () => {
    await dispatchOutbox({
      store: outboxStore,
      workerId: outboxWorkerId,
      publish: async (operation, signal) => {
        if (signal.aborted) throw new Error("worker is stopping");
        if (operation.queue !== SNAPSHOT_RETENTION_QUEUE) throw new Error("unsupported member outbox queue");
        const payload = operation.payload;
        if (payload === null || Array.isArray(payload) || typeof payload !== "object" || typeof payload["snapshotId"] !== "string") {
          throw new TypeError("snapshot retention outbox payload is invalid");
        }
        await boss.send(SNAPSHOT_RETENTION_QUEUE, { snapshotId: payload["snapshotId"] }, { singletonKey: operation.operationId });
      },
    }, stopping.signal);
  });
  const pruneSnapshots = tick("snapshot cleanup", async () => {
    const result = await trackRetention(() => pruneExpiredSnapshots(retentionDependencies));
    if (result.released > 0 || result.retained > 0) log("snapshot cleanup released " + result.released + " and retained " + result.retained);
  });
  const recoverSnapshots = tick("snapshot recovery", async () => {
    const result = await trackRetention(() => recoverStaleSnapshots(retentionDependencies));
    if (result.attempted > 0) {
      log("snapshot recovery attempted " + result.attempted + ", readied " + result.ready
        + ", failed " + result.failed + ", retryable " + result.retryable);
    }
  });
  const pruneJobs = tick("job workspace cleanup", async () => {
    const removed = await pruneJobWorkspaces({ storage: options.storage, store: jobStore, retentionMs });
    if (removed.length > 0) log(`removed ${removed.length} expired job workspace(s)`);
  });
  const timers = [
    setInterval(() => void scanPending(), (options.pendingScanSeconds ?? 5) * 1000),
    setInterval(() => void pollAll(), options.pollIntervalSeconds * 1000),
    setInterval(() => void watchReviews(), (options.reviewWatchSeconds ?? 60) * 1000),
    setInterval(() => void pruneJobs(), (options.cleanupIntervalSeconds ?? 60 * 60) * 1000),
    setInterval(() => void checkCancels(), (options.cancelPollSeconds ?? 2) * 1000),
    setInterval(() => void dispatchMemberOutbox(), (options.outboxScanSeconds ?? 1) * 1000),
    setInterval(() => void pruneSnapshots(), (options.snapshotCleanupSeconds ?? 60 * 60) * 1000),
    setInterval(() => void recoverSnapshots(), (options.snapshotRecoverySeconds ?? 60) * 1000),
  ];
  void pollAll();
  void pruneJobs();
  void dispatchMemberOutbox();
  void pruneSnapshots();
  void recoverSnapshots();
  void watchReviews();

  const heartbeat = await startHeartbeat({
    pool: options.pool,
    queues: [GIT_SYNC_QUEUE, DOCUMENT_WRITE_QUEUE, SNAPSHOT_RETENTION_QUEUE, ...(options.jobs === undefined ? [] : [JOB_RUN_QUEUE])],
    activeJobs: () => busy,
    ...(options.heartbeatSeconds === undefined ? {} : { intervalSeconds: options.heartbeatSeconds }),
    log,
  });

  let stopResult: Promise<void> | undefined;
  return {
    workerId: heartbeat.workerId,
    requestSync,
    requestWrite,
    requestJobRun: (request) => sendJobRun(boss, request),
    stop() {
      if (stopResult !== undefined) return stopResult;
      stopped = true;
      stopRebuilds();
      stopping.abort();
      for (const timer of timers) clearInterval(timer);
      stopResult = (async () => {
        try {
          // Ticks may still send work to the queue, so drain them before stopping it.
          await Promise.allSettled(backgroundTicks.values());
          await boss.stop({ graceful: true });
        } finally {
          // A queue stop timeout must not close sessions beneath active retention work.
          await Promise.allSettled(retentionOperations);
          await Promise.all([heartbeat.stop(), retentionPool.end()]);
        }
      })();
      return stopResult;
    },
  };
}
