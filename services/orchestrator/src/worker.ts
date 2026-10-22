// The kintsugi-worker process core (ADR-0003, ADR-0019, ADR-0025, ADR-0029): pg-boss queues
// for Git sync, document writes and runtime job runs, plus the scheduler that feeds Git sync. New repositories are
// picked up within seconds; every repository is re-synced each poll interval; removed ones
// lose their mirror. Document writes run one at a time per document repository.

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { loadBuiltinPlugins, readBuiltinPluginFile } from "@kintsugi/agents";
import {
  CheckoutStorage,
  GitHubInstallationCredentialProvider,
  GitHubProviderCredentialProvider,
  GitHubPullRequestObserver,
} from "@kintsugi/git";
import { type Interpreters, interpretersFromEnv, loadMcpServers } from "@kintsugi/runtime/launcher";
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
import { createPersistedGateDecider } from "./jobs/persisted-gate-decider.js";
import { type JobDefaults, JobRunner } from "./jobs/runner.js";
import { JobCancelled } from "./jobs/model.js";
import { PgJobStore } from "./jobs/store.js";
import { onDefaultTipMove, pruneMirrors, syncRepository } from "./git-sync/sync.js";
import { triggerRebuilds } from "./aggregates.js";
import { dispatchOutbox, PostgresOutboxStore } from "./outbox/index.js";
import { publishGate } from "./gates/publish.js";
import { CONTINUATION_QUEUE } from "./member-workflow/continue.js";
import { dispatchContinuation } from "./member-workflow/dispatch.js";
import { PostgresGateReconciler } from "./gates/reconcile.js";
import { GitSnapshotPins, pruneExpiredSnapshots, recoverStaleSnapshots, retainSnapshot } from "./git-sync/retention.js";
import { PostgresSnapshotRetentionRepository } from "./git-sync/retention-store.js";
import { pruneMemberEvents } from "./member-event-retention.js";
import { PostgresProviderSyncStore } from "./provider-sync/inbox.js";
import { discoverChanges } from "./provider-sync/reconcile.js";
import { materializeReviewInput } from "./member-reviews/inputs.js";
import { scheduleReview } from "./member-reviews/schedule.js";
import { PostgresMemberReviewStore, ReviewScheduleRejectedError } from "./member-reviews/store.js";
import { runMemberReviewJob } from "./member-reviews/worker.js";
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
  /** Seconds between scans of due GitHub/GHES provider repositories (default 1). */
  providerSyncScanSeconds?: number;
  /** Maximum due provider repositories claimed by one scan (default 20). */
  providerSyncBatchSize?: number;
  /** Poll interval after a complete provider sweep (default 120). */
  providerPollIntervalSeconds?: number;
  /** Full all-state history backfill interval (default daily). */
  providerDeepBackfillSeconds?: number;
  /** Parallel syncs in this process. */
  concurrency?: number;
  /** For tests: the HTTP client of the pull-request adapters. */
  fetch?: typeof fetch;
  log?: (message: string) => void;
  /** Days the output of a failed run or write is kept (KINTSUGI_JOB_RETENTION_DAYS, default 7). */
  jobRetentionDays?: number;
  /** Days the spans of agent jobs are kept (KINTSUGI_TELEMETRY_RETENTION_DAYS, default 30). */
  telemetryRetentionDays?: number;
  /** Seconds between looks at pull requests awaiting review, to record a merge or a close (default 60). */
  reviewWatchSeconds?: number;
  /** Seconds between scans for confirmed open pull requests that need a Kintsugi review (default 30). */
  memberReviewScanSeconds?: number;
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
  /** Seconds between physical cleanup of expired task event replay rows (default: hourly). */
  memberEventCleanupSeconds?: number;
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
  const providerSyncStore = new PostgresProviderSyncStore(options.pool);
  const memberReviewStore = new PostgresMemberReviewStore(options.pool);
  const githubObserver = new GitHubPullRequestObserver({
    credentials: new GitHubProviderCredentialProvider({
      apps: new GitHubInstallationCredentialProvider({ ...(options.fetch === undefined ? {} : { fetch: options.fetch }) }),
    }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const gateReconciler = new PostgresGateReconciler({ pool: options.pool, repositories: store, storage: options.storage, observer: githubObserver });
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
  let runner: JobRunner | undefined;
  let reviewAgentVersion: string | undefined;
  let reviewOutputSchema: Record<string, unknown> | undefined;
  await ensureJobRunQueue(boss);
  if (options.jobs !== undefined) {
    const agentDefinitions = installedAgents({ pool: options.pool });
    const pluginCatalog = await loadBuiltinPlugins();
    const reviewPlugin = pluginCatalog.find((plugin) => plugin.name === "review");
    const reviewSchemaText = reviewPlugin === undefined
      ? undefined
      : await readBuiltinPluginFile(pluginCatalog, "review", "schemas/review-report.schema.json");
    if (reviewPlugin === undefined || reviewSchemaText === undefined) throw new Error("the built-in review plugin is incomplete");
    const parsedReviewSchema: unknown = JSON.parse(reviewSchemaText);
    if (parsedReviewSchema === null || Array.isArray(parsedReviewSchema) || typeof parsedReviewSchema !== "object") {
      throw new Error("the built-in review report schema is invalid");
    }
    const reviewDefinition = await agentDefinitions.definition("gate-reviewer");
    if (reviewPlugin.version !== reviewDefinition.version) throw new Error("the review plugin and gate-reviewer versions must match");
    reviewAgentVersion = reviewDefinition.version;
    reviewOutputSchema = parsedReviewSchema as Record<string, unknown>;

    runner = new JobRunner({
      store: jobStore,
      storage: options.storage,
      checkouts: new MirrorCheckouts({ repositories: store, storage: options.storage }),
      gates: createPersistedGateDecider({ db: options.pool }),
      agents: options.jobs.agents,
      agentDefinitions,
      mcpServers: (ids) => loadMcpServers(ids, options.databaseUrl),
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
        if (runner === undefined) throw new Error("runtime job runner is unavailable");
        await runMemberReviewJob({
          store: memberReviewStore,
          run: (jobRunId, signal) => runner!.run(jobRunId, signal),
          outputDirectory: (jobRunId) => options.storage.job(jobRunId).out,
        }, job.data.jobRunId, AbortSignal.any([stopping.signal, cancel.signal]));
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
  const syncProviderChanges = tick("provider sync", async () => {
    for (const repositoryId of await providerSyncStore.repositoriesToSync(options.providerSyncBatchSize ?? 20)) {
      const result = await discoverChanges({
        store: providerSyncStore,
        connections: store,
        observer: githubObserver,
        ...(options.providerPollIntervalSeconds === undefined ? {} : { pollIntervalSeconds: options.providerPollIntervalSeconds }),
        ...(options.providerDeepBackfillSeconds === undefined ? {} : { deepBackfillSeconds: options.providerDeepBackfillSeconds }),
      }, repositoryId);
      if (result.status === "failed") log(`provider sync ${repositoryId} failed: ${result.errorCode}`);
      else if (result.status === "partial") log(`provider sync ${repositoryId} resumed after ${result.pages} page(s)`);
    }
  });
  const reconcileGates = tick("gate reconciliation", () => gateReconciler.scan(log));
  const watchReviews = tick("review watch", async () => {
    const outcome = await watchPullRequests({ ...writerDeps, log });
    if (outcome.merged.length + outcome.closed.length > 0) log(`review watch: ${outcome.merged.length} merged, ${outcome.closed.length} closed`);
  });
  const scheduleMemberReviews = tick("member review scheduling", async () => {
    if (options.jobs === undefined || reviewAgentVersion === undefined || reviewOutputSchema === undefined) return;
    const candidates = await memberReviewStore.candidates(reviewAgentVersion);
    for (const candidate of candidates) {
      try {
        const scheduled = await scheduleReview({
          store: memberReviewStore,
          outputSchema: reviewOutputSchema,
          prepare: (jobRunId) => materializeReviewInput({ storage: options.storage, repositories: store }, candidate.observed, candidate.snapshot, jobRunId),
          discard: async (jobRunId) => rm(options.storage.job(jobRunId).root, { recursive: true, force: true }),
        }, candidate.key, "automatic");
        if (scheduled.created) {
          log(`queued review ${scheduled.attempt.reviewId} generation ${scheduled.attempt.generation} for PR #${candidate.key.pullRequestNumber}`);
        }
      } catch (error) {
        if (error instanceof ReviewScheduleRejectedError) continue;
        const kind = error instanceof Error ? error.name : "unknown";
        log(`review scheduling for PR #${candidate.key.pullRequestNumber} failed (${kind})`);
      }
    }
  });
  const recoverMemberReviews = tick("member review recovery", async () => {
    if (options.jobs === undefined || runner === undefined) return;
    const execution = {
      store: memberReviewStore,
      run: (jobRunId: string, signal?: AbortSignal) => runner!.run(jobRunId, signal),
      outputDirectory: (jobRunId: string) => options.storage.job(jobRunId).out,
    };
    for (const jobRunId of await memberReviewStore.terminalJobRuns()) {
      await runMemberReviewJob(execution, jobRunId, stopping.signal);
    }
    for (const jobRunId of await memberReviewStore.queuedJobRuns()) {
      await sendJobRun(boss, { jobRunId });
    }
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
        const payload = operation.payload;
        if (operation.queue === SNAPSHOT_RETENTION_QUEUE) {
          if (payload === null || Array.isArray(payload) || typeof payload !== "object" || typeof payload["snapshotId"] !== "string") {
            throw new TypeError("snapshot retention outbox payload is invalid");
          }
          await boss.send(SNAPSHOT_RETENTION_QUEUE, { snapshotId: payload["snapshotId"] }, { singletonKey: operation.operationId });
          return;
        }
        if (operation.queue === CONTINUATION_QUEUE) {
          await dispatchContinuation({ pool: options.pool, current: input => gateReconciler.currentContinuation(input), recheckAuthority: (client, evidence, reviewers) => gateReconciler.recheckAuthority(client, evidence, reviewers) }, operation);
          return;
        }
        if (operation.queue === DOCUMENT_WRITE_QUEUE) {
          await publishGate({ enqueue: (repositoryId, request) => sendDocumentWrite(boss, repositoryId, request) }, operation);
          return;
        }
        if (operation.queue === JOB_RUN_QUEUE) {
          if (payload === null || Array.isArray(payload) || typeof payload !== "object" || typeof payload["jobRunId"] !== "string") {
            throw new TypeError("job-run outbox payload is invalid");
          }
          await sendJobRun(boss, { jobRunId: payload["jobRunId"] });
          return;
        }
        throw new Error("unsupported member outbox queue");
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
    const spans = await jobStore.pruneTelemetry(options.telemetryRetentionDays ?? 30);
    if (spans > 0) log(`removed ${spans} expired telemetry span(s)`);
  });
  const pruneMemberEventLog = tick("member event cleanup", async () => {
    const removed = await pruneMemberEvents(options.pool);
    if (removed > 0) log(`removed ${removed} expired member event(s)`);
  });
  const timers = [
    setInterval(() => void scanPending(), (options.pendingScanSeconds ?? 5) * 1000),
    setInterval(() => void syncProviderChanges(), (options.providerSyncScanSeconds ?? 1) * 1000),
    setInterval(() => void pollAll(), options.pollIntervalSeconds * 1000),
    setInterval(() => void watchReviews(), (options.reviewWatchSeconds ?? 60) * 1000),
    setInterval(() => void reconcileGates(), (options.reviewWatchSeconds ?? 60) * 1000),
    ...(options.jobs === undefined ? [] : [
      setInterval(() => void scheduleMemberReviews(), (options.memberReviewScanSeconds ?? 30) * 1000),
      setInterval(() => void recoverMemberReviews(), 30 * 1000),
    ]),
    setInterval(() => void pruneJobs(), (options.cleanupIntervalSeconds ?? 60 * 60) * 1000),
    setInterval(() => void checkCancels(), (options.cancelPollSeconds ?? 2) * 1000),
    setInterval(() => void dispatchMemberOutbox(), (options.outboxScanSeconds ?? 1) * 1000),
    setInterval(() => void pruneSnapshots(), (options.snapshotCleanupSeconds ?? 60 * 60) * 1000),
    setInterval(() => void pruneMemberEventLog(), (options.memberEventCleanupSeconds ?? 60 * 60) * 1000),
    setInterval(() => void recoverSnapshots(), (options.snapshotRecoverySeconds ?? 60) * 1000),
  ];
  void pollAll();
  void syncProviderChanges();
  void pruneJobs();
  void dispatchMemberOutbox();
  if (options.jobs !== undefined) {
    void scheduleMemberReviews();
    void recoverMemberReviews();
  }
  void pruneSnapshots();
  void pruneMemberEventLog();
  void recoverSnapshots();
  void watchReviews();
  void reconcileGates();

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
