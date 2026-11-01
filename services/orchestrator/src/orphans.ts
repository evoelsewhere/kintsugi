// Runs the worker left unfinished. A run is only `running` while a worker process drives it; when
// the worker dies (restart, redeploy, crash) the row stays `running` for good: the job-run queue
// never redelivers it (retryLimit 0) and nothing else updates it. A starting worker fails them,
// unless another worker is alive (its heartbeat is fresh), whose runs they might be.

import { hostname } from "node:os";
import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { attemptsWith } from "./jobs/store.js";
import { JOB_RUN_QUEUE, QUEUE_SCHEMA } from "./queues.js";

/** A worker not seen for this long is dead (the API reports a worker up within 45 s). */
const ALIVE_SECONDS = 45;

export const INTERRUPTED = "Interrupted: the worker stopped while this run was running. Retry the run to continue from the finished steps.";

/** Whether a worker of this host is still running (a restart leaves its row looking fresh for a while). */
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Whether a worker other than this process beats: another host's while it beats, one on this host while its process exists. */
async function anotherWorkerAlive(pool: Pick<Pool, "query">): Promise<boolean> {
  const seen = await pool.query<{ host: string; pid: number }>(
    "select host, pid from workflow.worker_heartbeat where stopped_at is null and last_seen_at > now() - make_interval(secs => $1)",
    [ALIVE_SECONDS],
  );
  return seen.rows.some((row) => row.host !== hostname() || (row.pid !== process.pid && processExists(row.pid)));
}

/** Fails the `running` runs (started before `before`, when given) left by dead workers; undefined when another worker is alive. */
async function sweep(pool: Pick<Pool, "query">, log: (message: string) => void, before?: unknown): Promise<number | undefined> {
  if (await anotherWorkerAlive(pool)) return undefined;
  // The interrupted attempt joins the run's history like any other end of an attempt, so a retry does not erase it (T2-012).
  const fail = `update workflow.job_run set status = 'failed', failure_reason = $1, finished_at = now(), attempts = ${attemptsWith("failed", "$1")} where status = 'running'`;
  const result = before === undefined ? await pool.query(fail, [INTERRUPTED]) : await pool.query(`${fail} and started_at < $2`, [INTERRUPTED, before]);
  const count = result.rowCount ?? 0;
  if (count > 0) log(`${count} run(s) left running by a stopped worker marked failed`);
  return count;
}

/**
 * Fails the job-run queue jobs a stopped worker left `active` whose run is no longer running (the sweep failed it, or it
 * ended otherwise): the queue keeps such a job active until it expires, 4 h later, and the monitoring counts it as a job
 * at work all that time (T2-022). A live worker's job always has a running run, so it is never touched. Returns how many.
 */
export async function failOrphanedQueueJobs(pool: Pick<Pool, "query">, boss: Pick<PgBoss, "fail">, log: (message: string) => void): Promise<number> {
  const stale = await pool.query<{ id: string }>(
    `select job.id from ${QUEUE_SCHEMA}.job job
       where job.name = $1 and job.state = 'active'
         and not exists (select 1 from workflow.job_run run where run.id::text = job.data->>'jobRunId' and run.status = 'running')`,
    [JOB_RUN_QUEUE],
  );
  const ids = stale.rows.map((row) => row.id);
  if (ids.length === 0) return 0;
  await boss.fail(JOB_RUN_QUEUE, ids, { reason: INTERRUPTED });
  log(`${ids.length} job-run queue job(s) a stopped worker left active marked failed`);
  return ids.length;
}

/**
 * Fails the jobs of `queues` a stopped worker left `active`, so pg-boss retries them now instead of after their expiry:
 * a document write a stopped worker had taken kept every write to that document repository waiting for 30 min, since
 * the queue runs one write per repository (DC-002). Called when a worker starts, before it takes any job, so no active
 * job is its own. It assumes one worker per installation: while another worker beats, its jobs may be the active ones,
 * so nothing is failed and they wait for their expiry as before. A retried write is safe: the writer pushes the same
 * branch again and finds the pull request it opened. Returns how many.
 */
export async function failStrandedQueueJobs(pool: Pick<Pool, "query">, boss: Pick<PgBoss, "fail">, queues: readonly string[], log: (message: string) => void): Promise<number> {
  if (queues.length === 0 || (await anotherWorkerAlive(pool))) return 0;
  const active = await pool.query<{ id: string; name: string }>(`select id, name from ${QUEUE_SCHEMA}.job where name = any($1) and state = 'active'`, [queues]);
  const byQueue = new Map<string, string[]>();
  for (const row of active.rows) byQueue.set(row.name, [...(byQueue.get(row.name) ?? []), row.id]);
  for (const [queue, ids] of byQueue) {
    await boss.fail(queue, ids, { reason: "Interrupted: the worker stopped while this job was running." });
    log(`${ids.length} ${queue} queue job(s) a stopped worker left active marked failed, to be retried`);
  }
  return active.rows.length;
}

/** Fails the `running` runs left by dead workers; returns how many. */
export async function failOrphanedRuns(pool: Pick<Pool, "query">, log: (message: string) => void): Promise<number> {
  return (await sweep(pool, log)) ?? 0;
}

/**
 * Fails the runs dead workers left `running` when this worker starts, and once more when another worker looked alive
 * then: a worker killed during a container recreate leaves a heartbeat that stays fresh for ALIVE_SECONDS, so the
 * start-up sweep skipped and its runs stayed `running` for good (T3-009). The second sweep fails only runs started
 * before this worker came up (by the database's clock), and skips too while another worker still beats. Returns a
 * function that cancels the second sweep.
 */
export async function sweepOrphanedRuns(pool: Pick<Pool, "query">, log: (message: string) => void, delayMs = (ALIVE_SECONDS + 5) * 1000): Promise<() => void> {
  const startedAt = (await pool.query<{ at: unknown }>("select now() as at")).rows[0]?.at;
  if ((await sweep(pool, log)) !== undefined || startedAt === undefined) return () => undefined;
  log(`another worker looks alive; checking again in ${Math.round(delayMs / 1000)} s for runs a stopped one left running`);
  const timer = setTimeout(() => void sweep(pool, log, startedAt).catch(() => undefined), delayMs);
  timer.unref();
  return () => clearTimeout(timer);
}
