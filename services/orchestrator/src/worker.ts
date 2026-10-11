// The kintsugi-worker process core (ADR-0003, ADR-0019, ADR-0025, ADR-0029): pg-boss queues
// for Git sync, document writes and runtime job runs, plus the scheduler that feeds Git sync. New repositories are
// picked up within seconds; every repository is re-synced each poll interval; removed ones
// lose their mirror. Document writes run one at a time per document repository.

import { CheckoutStorage } from "@kintsugi/git";
import { type Interpreters, interpretersFromEnv } from "@kintsugi/runtime/launcher";
import type { AgentRuntime } from "@kintsugi/runtime-sdk";
import { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { DocumentWriteStore } from "./document-write/store.js";
import { writeDocument } from "./document-write/writer.js";
import { RepositoryStore } from "./git-sync/repositories.js";
import { builtinAgents } from "./jobs/agents.js";
import { DEFAULT_JOB_RETENTION_DAYS, pruneJobWorkspaces, removeJobWorkspace } from "./jobs/cleanup.js";
import { MirrorCheckouts } from "./jobs/checkouts.js";
import { type JobDefaults, JobRunner } from "./jobs/runner.js";
import { JobCancelled } from "./jobs/model.js";
import { PgJobStore } from "./jobs/store.js";
import { pruneMirrors, syncRepository } from "./git-sync/sync.js";
import {
  DOCUMENT_WRITE_QUEUE,
  type DocumentWriteRequest,
  GIT_SYNC_QUEUE,
  JOB_RUN_QUEUE,
  type JobRunRequest,
  QUEUE_SCHEMA,
  ensureDocumentWriteQueue,
  ensureJobRunQueue,
  sendDocumentWrite,
  sendJobRun,
} from "./queues.js";

export { GIT_SYNC_QUEUE, QUEUE_SCHEMA } from "./queues.js";

/** Default author email of kintsugi-bot; `.invalid` never delivers mail. */
export const DEFAULT_BOT_EMAIL = "kintsugi-bot@kintsugi.invalid";

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
  /** Author email of kintsugi-bot's commits (KINTSUGI_BOT_EMAIL). */
  botEmail?: string;
  /** For tests: the HTTP client of the pull-request adapters. */
  fetch?: typeof fetch;
  log?: (message: string) => void;
  /** Days the output of a failed run or write is kept (KINTSUGI_JOB_RETENTION_DAYS, default 7). */
  jobRetentionDays?: number;
  /** Seconds between sweeps of expired job workspaces (default: hourly). */
  cleanupIntervalSeconds?: number;
  /** Seconds between checks for cancel requests of the runs this worker runs (default 2). */
  cancelPollSeconds?: number;
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
    botEmail: options.botEmail ?? DEFAULT_BOT_EMAIL,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
  await options.storage.prepare();

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

  await boss.work<{ repositoryId: string }>(GIT_SYNC_QUEUE, { localConcurrency: options.concurrency ?? 2 }, async ([job]) => {
    if (job === undefined) return;
    const result = await syncRepository(deps, job.data.repositoryId);
    if (result !== undefined) log(`${result.cloned ? "cloned" : "fetched"} ${result.repositoryId} at ${result.commit.slice(0, 12)}`);
  });

  // One active write per document repository (singleton policy); different repositories in parallel.
  await boss.work<DocumentWriteRequest>(DOCUMENT_WRITE_QUEUE, { localConcurrency: options.concurrency ?? 2 }, async ([job]) => {
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
  });

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
      agentDefinitions: builtinAgents(),
      interpreters: options.jobs.interpreters ?? interpretersFromEnv(),
      ...(options.jobs.defaults === undefined ? {} : { defaults: options.jobs.defaults }),
      requestWrite,
      log,
    });
    await boss.work<JobRunRequest>(JOB_RUN_QUEUE, { localConcurrency: options.jobs.concurrency ?? 2 }, async ([job]) => {
      if (job === undefined) return;
      // One controller per run: a cancel request aborts this run only (its processes are killed).
      const cancel = new AbortController();
      active.set(job.data.jobRunId, cancel);
      try {
        await runner.run(job.data.jobRunId, AbortSignal.any([stopping.signal, cancel.signal]));
      } finally {
        active.delete(job.data.jobRunId);
      }
    });
  }
  const watchCancels = async (): Promise<void> => {
    if (active.size === 0) return;
    for (const id of await jobStore.cancelRequested([...active.keys()])) active.get(id)?.abort(new JobCancelled());
  };

  const requestSync = async (repositoryId: string): Promise<void> => {
    await boss.send(GIT_SYNC_QUEUE, { repositoryId }, { singletonKey: repositoryId });
  };

  // Scheduler: each tick is independent; a failed tick is logged and the next one retries.
  let stopped = false;
  const tick = (name: string, work: () => Promise<void>) => async (): Promise<void> => {
    if (stopped) return;
    try {
      await work();
    } catch (error) {
      log(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const scanPending = tick("pending scan", async () => {
    for (const id of await store.ids("pending")) await requestSync(id);
  });
  const pollAll = tick("poll", async () => {
    for (const id of await store.ids()) await requestSync(id);
    for (const key of await pruneMirrors(deps)) log(`pruned mirror ${key}`);
  });
  const retentionMs = (options.jobRetentionDays ?? DEFAULT_JOB_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
  const checkCancels = tick("cancel check", watchCancels);
  const pruneJobs = tick("job workspace cleanup", async () => {
    const removed = await pruneJobWorkspaces({ storage: options.storage, store: jobStore, retentionMs });
    if (removed.length > 0) log(`removed ${removed.length} expired job workspace(s)`);
  });
  const timers = [
    setInterval(() => void scanPending(), (options.pendingScanSeconds ?? 5) * 1000),
    setInterval(() => void pollAll(), options.pollIntervalSeconds * 1000),
    setInterval(() => void pruneJobs(), (options.cleanupIntervalSeconds ?? 60 * 60) * 1000),
    setInterval(() => void checkCancels(), (options.cancelPollSeconds ?? 2) * 1000),
  ];
  void pollAll();
  void pruneJobs();

  return {
    requestSync,
    requestWrite,
    requestJobRun: (request) => sendJobRun(boss, request),
    async stop() {
      stopped = true;
      stopping.abort();
      for (const timer of timers) clearInterval(timer);
      await boss.stop({ graceful: true });
    },
  };
}
