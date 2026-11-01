// Runs the worker left unfinished. A run is only `running` while a worker process drives it; when
// the worker dies (restart, redeploy, crash) the row stays `running` for good: the job-run queue
// never redelivers it (retryLimit 0) and nothing else updates it. A starting worker fails them,
// unless another worker is alive (its heartbeat is fresh), whose runs they might be.

import { hostname } from "node:os";
import type { Pool } from "pg";
import { attemptsWith } from "./jobs/store.js";

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

/** Fails the `running` runs (started before `before`, when given) left by dead workers; undefined when another worker is alive. */
async function sweep(pool: Pick<Pool, "query">, log: (message: string) => void, before?: unknown): Promise<number | undefined> {
  const seen = await pool.query<{ host: string; pid: number }>(
    "select host, pid from workflow.worker_heartbeat where stopped_at is null and last_seen_at > now() - make_interval(secs => $1)",
    [ALIVE_SECONDS],
  );
  // Another host's worker counts as alive while it beats; on this host its process must exist too.
  if (seen.rows.some((row) => row.host !== hostname() || (row.pid !== process.pid && processExists(row.pid)))) return undefined;
  // The interrupted attempt joins the run's history like any other end of an attempt, so a retry does not erase it (T2-012).
  const fail = `update workflow.job_run set status = 'failed', failure_reason = $1, finished_at = now(), attempts = ${attemptsWith("failed", "$1")} where status = 'running'`;
  const result = before === undefined ? await pool.query(fail, [INTERRUPTED]) : await pool.query(`${fail} and started_at < $2`, [INTERRUPTED, before]);
  const count = result.rowCount ?? 0;
  if (count > 0) log(`${count} run(s) left running by a stopped worker marked failed`);
  return count;
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
