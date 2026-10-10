// The kintsugi-worker process core (ADR-0003, ADR-0025): a pg-boss queue for Git sync
// plus the scheduler that feeds it. New repositories are picked up within seconds;
// every repository is re-synced each poll interval; removed ones lose their mirror.

import { CheckoutStorage } from "@kintsugi/git";
import { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { RepositoryStore } from "./git-sync/repositories.js";
import { pruneMirrors, syncRepository } from "./git-sync/sync.js";

/** pg-boss owns this schema (an infrastructure library, not a domain schema). */
export const QUEUE_SCHEMA = "pgboss";
export const GIT_SYNC_QUEUE = "git-sync";

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
  log?: (message: string) => void;
}

export interface Worker {
  /** Enqueues a sync; deduplicated per repository (one queued and one running at most). */
  requestSync(repositoryId: string): Promise<void>;
  stop(): Promise<void>;
}

export async function startWorker(options: WorkerOptions): Promise<Worker> {
  const log = options.log ?? ((message: string) => console.log(`[worker] ${message}`));
  const store = new RepositoryStore(options.pool);
  const deps = { store, storage: options.storage };
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

  await boss.work<{ repositoryId: string }>(GIT_SYNC_QUEUE, { localConcurrency: options.concurrency ?? 2 }, async ([job]) => {
    if (job === undefined) return;
    const result = await syncRepository(deps, job.data.repositoryId);
    if (result !== undefined) log(`${result.cloned ? "cloned" : "fetched"} ${result.repositoryId} at ${result.commit.slice(0, 12)}`);
  });

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
  const timers = [
    setInterval(() => void scanPending(), (options.pendingScanSeconds ?? 5) * 1000),
    setInterval(() => void pollAll(), options.pollIntervalSeconds * 1000),
  ];
  void pollAll();

  return {
    requestSync,
    async stop() {
      stopped = true;
      for (const timer of timers) clearInterval(timer);
      await boss.stop({ graceful: true });
    },
  };
}
