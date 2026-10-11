// The API's handle on the worker's job queue (ADR-0003: pg-boss on the installation's
// Postgres). The API only produces jobs: no maintenance, no cron, no workers — the worker
// (services/orchestrator) runs them. Queue names, options and payloads come from
// `@kintsugi/orchestrator/queues`, so both sides agree on them.

import { QUEUE_SCHEMA } from "@kintsugi/orchestrator/queues";
import { PgBoss } from "pg-boss";

let boss: Promise<PgBoss> | undefined;

/** The started producer, created on first use from DATABASE_URL. */
export function getJobQueue(): Promise<PgBoss> {
  boss ??= (async () => {
    const url = process.env["DATABASE_URL"];
    if (url === undefined || url.length === 0) throw new Error("DATABASE_URL is not set; the job queue lives in the installation's Postgres");
    const instance = new PgBoss({ connectionString: url, schema: QUEUE_SCHEMA, supervise: false, schedule: false, max: 2 });
    instance.on("error", (error: Error) => console.error(`[job-queue] ${error.message}`));
    await instance.start();
    return instance;
  })().catch((error: unknown) => {
    boss = undefined; // the next call retries
    throw error;
  });
  return boss;
}

/** Stops the producer if it was started; safe to call more than once. */
export async function closeJobQueue(): Promise<void> {
  const started = boss;
  boss = undefined;
  if (started !== undefined) await (await started.catch(() => undefined))?.stop({ graceful: false });
}
