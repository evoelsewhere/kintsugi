// The kintsugi-worker process core (ADR-0003, ADR-0019, ADR-0025, ADR-0029): pg-boss queues
// for Git sync, document writes and runtime job runs, plus the scheduler that feeds Git sync. New repositories are
// picked up within seconds; every repository is re-synced each poll interval; removed ones
// lose their mirror. Document writes run one at a time per document repository.

import { randomUUID } from "node:crypto";
import { CheckoutStorage } from "@kintsugi/git";
import { type Interpreters, interpretersFromEnv, loadMcpServers } from "@kintsugi/runtime/launcher";
import type { AgentRuntime } from "@kintsugi/runtime-sdk";
import { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { DocumentWriteStore } from "./document-write/store.js";
import { startHeartbeat } from "./heartbeat.js";
import { failOrphanedRuns } from "./orphans.js";
import { watchPullRequests } from "./document-write/watch.js";
import { writeDocument } from "./document-write/writer.js";
import { RepositoryStore } from "./git-sync/repositories.js";
import { installedAgents } from "./jobs/agents.js";
import { dropExpiredCheckouts, pruneJobWorkspaces, removeJobWorkspace, removeWorkspaceOnRequest } from "./jobs/cleanup.js";
import { type SandboxProvider, pgSandbox } from "./sandbox.js";
import { MirrorCheckouts } from "./jobs/checkouts.js";
import { createPersistedGateDecider } from "./jobs/persisted-gate-decider.js";
import { type JobDefaults, JobRunner } from "./jobs/runner.js";
import { JobCancelled } from "./jobs/model.js";
import { PgJobStore } from "./jobs/store.js";
import { onDefaultTipMove, pruneMirrors, syncRepository } from "./git-sync/sync.js";
import { triggerRebuilds } from "./aggregates.js";
import { dispatchOutbox, PostgresOutboxStore } from "./outbox/index.js";
import {
  DOCUMENT_WRITE_QUEUE,
  type DocumentWriteRequest,
  GIT_SYNC_QUEUE,
  JOB_RUN_QUEUE,
  type JobRunRequest,
  QUEUE_SCHEMA,
  WORKSPACE_CLEANUP_QUEUE,
  type WorkspaceCleanupRequest,
  ensureDocumentWriteQueue,
  ensureJobRunQueue,
  ensureWorkspaceCleanupQueue,
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
  /** The sandbox settings (Settings → Sandbox, ADR-0055); default: read from the database. */
  sandbox?: SandboxProvider;
  /** Days the spans of agent jobs are kept (KINTSUGI_TELEMETRY_RETENTION_DAYS, default 30). */
  telemetryRetentionDays?: number;
  /** Seconds between looks at pull requests awaiting review, to record a merge or a close (default 60). */
  reviewWatchSeconds?: number;
  /** Seconds between sweeps of expired job workspaces (default: hourly). */
  cleanupIntervalSeconds?: number;
  /** Seconds between scans for durable queue intents of the workflow outbox (default 1). */
  outboxScanSeconds?: number;
  /** Seconds between checks for cancel requests of the runs this worker runs (default 2). */
  cancelPollSeconds?: number;
  /** Seconds between heartbeats in workflow.worker_heartbeat (ADR-0030, default 15). */
  heartbeatSeconds?: number;
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
  const checkouts = new MirrorCheckouts({ repositories: store, storage: options.storage });
  const sandbox = options.sandbox ?? pgSandbox(options.pool);
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
  let runner: JobRunner | undefined;
  await ensureJobRunQueue(boss);
  if (options.jobs !== undefined) {
    const agentDefinitions = installedAgents({ pool: options.pool });
    runner = new JobRunner({
      store: jobStore,
      storage: options.storage,
      checkouts,
      gates: createPersistedGateDecider({ db: options.pool }),
      agents: options.jobs.agents,
      agentDefinitions,
      mcpServers: (ids) => loadMcpServers(ids, options.databaseUrl),
      interpreters: options.jobs.interpreters ?? interpretersFromEnv(),
      ...(options.jobs.defaults === undefined ? {} : { defaults: options.jobs.defaults }),
      sandbox,
      requestWrite,
      log,
    });
    await boss.work<JobRunRequest>(JOB_RUN_QUEUE, { localConcurrency: options.jobs.concurrency ?? 2 }, counted(async ([job]) => {
      if (job === undefined) return;
      // One controller per run: a cancel request aborts this run only (its processes are killed).
      const cancel = new AbortController();
      active.set(job.data.jobRunId, cancel);
      try {
        if (runner === undefined) throw new Error("runtime job runner is unavailable");
        await runner.run(job.data.jobRunId, AbortSignal.any([stopping.signal, cancel.signal]));
      } finally {
        active.delete(job.data.jobRunId);
      }
    }));
  }
  // An admin removes a job workspace from Settings -> Sandbox (ADR-0058): the API asks, this process owns the disk.
  await ensureWorkspaceCleanupQueue(boss);
  await boss.work<WorkspaceCleanupRequest>(WORKSPACE_CLEANUP_QUEUE, { localConcurrency: 1 }, counted(async ([job]) => {
    if (job === undefined) return;
    const outcome = await removeWorkspaceOnRequest({ storage: options.storage, store: jobStore, jobId: job.data.jobId });
    log(`workspace ${job.data.jobId}: ${outcome}${job.data.actor === undefined ? "" : ` (asked by ${job.data.actor})`}`);
  }));
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
  const checkCancels = tick("cancel check", watchCancels);
  const outboxStore = new PostgresOutboxStore(options.pool);
  const outboxWorkerId = randomUUID();
  const dispatchWorkflowOutbox = tick("workflow outbox", async () => {
    await dispatchOutbox({
      store: outboxStore,
      workerId: outboxWorkerId,
      publish: async (operation, signal) => {
        if (signal.aborted) throw new Error("worker is stopping");
        const payload = operation.payload;
        if (operation.queue === JOB_RUN_QUEUE) {
          if (payload === null || Array.isArray(payload) || typeof payload !== "object" || typeof payload["jobRunId"] !== "string") {
            throw new TypeError("job-run outbox payload is invalid");
          }
          await sendJobRun(boss, { jobRunId: payload["jobRunId"] });
          return;
        }
        throw new Error("unsupported outbox queue");
      },
    }, stopping.signal);
  });
  const pruneJobs = tick("job workspace cleanup", async () => {
    const settings = await sandbox();
    const retentionMs = settings.retentionDays * 24 * 60 * 60 * 1000;
    const checkoutMs = settings.checkoutHours * 60 * 60 * 1000;
    const dropped = await dropExpiredCheckouts({ storage: options.storage, store: jobStore, checkouts, checkoutMs });
    if (dropped.length > 0) log(`dropped the checkouts of ${dropped.length} failed job(s) (they are made again by a retry)`);
    const removed = await pruneJobWorkspaces({ storage: options.storage, store: jobStore, retentionMs });
    if (removed.length > 0) log(`removed ${removed.length} expired job workspace(s)`);
    await checkouts.pruneWorktrees();
    const spans = await jobStore.pruneTelemetry(options.telemetryRetentionDays ?? 30);
    if (spans > 0) log(`removed ${spans} expired telemetry span(s)`);
  });
  const timers = [
    setInterval(() => void scanPending(), (options.pendingScanSeconds ?? 5) * 1000),
    setInterval(() => void pollAll(), options.pollIntervalSeconds * 1000),
    setInterval(() => void watchReviews(), (options.reviewWatchSeconds ?? 60) * 1000),
    setInterval(() => void pruneJobs(), (options.cleanupIntervalSeconds ?? 60 * 60) * 1000),
    setInterval(() => void checkCancels(), (options.cancelPollSeconds ?? 2) * 1000),
    setInterval(() => void dispatchWorkflowOutbox(), (options.outboxScanSeconds ?? 1) * 1000),
  ];
  void pollAll();
  void pruneJobs();
  void dispatchWorkflowOutbox();
  void watchReviews();

  const heartbeat = await startHeartbeat({
    pool: options.pool,
    queues: [GIT_SYNC_QUEUE, DOCUMENT_WRITE_QUEUE, WORKSPACE_CLEANUP_QUEUE, ...(options.jobs === undefined ? [] : [JOB_RUN_QUEUE])],
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
          await heartbeat.stop();
        }
      })();
      return stopResult;
    },
  };
}
