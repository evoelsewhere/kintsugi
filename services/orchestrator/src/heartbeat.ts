// Worker heartbeat (ADR-0030, migration 014: workflow.worker_heartbeat). The worker upserts its
// row every 15 seconds — host, pid, version, active jobs, queues — and marks it stopped on a
// clean shutdown. The API reports a worker as up when its row was seen less than 45 seconds ago.
// A failed beat is logged and retried at the next tick; it never stops the worker.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import type { Pool } from "pg";

/** Seconds between two beats. */
export const HEARTBEAT_INTERVAL_SECONDS = 15;

/** Rows of workers not seen for this long are removed when a worker starts. */
const FORGET_AFTER_DAYS = 7;

export interface HeartbeatOptions {
  pool: Pick<Pool, "query">;
  /** The queues this process works. */
  queues: readonly string[];
  /** Jobs in progress right now. */
  activeJobs: () => number;
  /** Defaults to HEARTBEAT_INTERVAL_SECONDS (tests use less). */
  intervalSeconds?: number;
  /** Defaults to a fresh id per process. */
  workerId?: string;
  /** Defaults to KINTSUGI_VERSION, else the package version. */
  version?: string;
  log?: (message: string) => void;
}

export interface Heartbeat {
  readonly workerId: string;
  /** Beats once now (also used by the timer). */
  beat(): Promise<void>;
  /** Stops beating and marks the row stopped. */
  stop(): Promise<void>;
}

/** The worker's version: KINTSUGI_VERSION (the image tag), else the package version. */
export function workerVersion(): string {
  const fromEnv = process.env["KINTSUGI_VERSION"]?.trim();
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function startHeartbeat(options: HeartbeatOptions): Promise<Heartbeat> {
  const log = options.log ?? ((message: string) => console.log(`[worker] ${message}`));
  const workerId = options.workerId ?? randomUUID();
  const version = options.version ?? workerVersion();
  const host = hostname();
  const startedAt = new Date();
  let stopped = false;

  const beat = async (): Promise<void> => {
    if (stopped) return;
    await options.pool.query(
      `insert into workflow.worker_heartbeat (worker_id, host, pid, version, started_at, last_seen_at, active_jobs, queues)
       values ($1, $2, $3, $4, $5, now(), $6, $7)
       on conflict (worker_id) do update set last_seen_at = now(), stopped_at = null, active_jobs = excluded.active_jobs, queues = excluded.queues`,
      [workerId, host, process.pid, version, startedAt, Math.max(0, options.activeJobs()), [...options.queues]],
    );
  };
  const tick = async (): Promise<void> => {
    try {
      await beat();
    } catch (error) {
      log(`heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await options.pool
    .query(`delete from workflow.worker_heartbeat where last_seen_at < now() - make_interval(days => $1)`, [FORGET_AFTER_DAYS])
    .catch((error: unknown) => log(`could not remove old heartbeats: ${error instanceof Error ? error.message : String(error)}`));
  await tick();
  const timer = setInterval(() => void tick(), (options.intervalSeconds ?? HEARTBEAT_INTERVAL_SECONDS) * 1000);

  return {
    workerId,
    beat,
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      try {
        await options.pool.query("update workflow.worker_heartbeat set stopped_at = now(), last_seen_at = now(), active_jobs = 0 where worker_id = $1", [workerId]);
      } catch (error) {
        log(`could not mark the heartbeat stopped: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
