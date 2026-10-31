// Runs the worker left unfinished. A run is only `running` while a worker process drives it; when
// the worker dies (restart, redeploy, crash) the row stays `running` for good: the job-run queue
// never redelivers it (retryLimit 0) and nothing else updates it. A starting worker fails them,
// unless another worker is alive (its heartbeat is fresh), whose runs they might be.

import { hostname } from "node:os";
import type { Pool } from "pg";

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

/** Fails the `running` runs left by dead workers; returns how many. */
export async function failOrphanedRuns(pool: Pick<Pool, "query">, log: (message: string) => void): Promise<number> {
  const seen = await pool.query<{ host: string; pid: number }>(
    "select host, pid from workflow.worker_heartbeat where stopped_at is null and last_seen_at > now() - make_interval(secs => $1)",
    [ALIVE_SECONDS],
  );
  // Another host's worker counts as alive while it beats; on this host its process must exist too.
  if (seen.rows.some((row) => row.host !== hostname() || (row.pid !== process.pid && processExists(row.pid)))) return 0;
  const result = await pool.query("update workflow.job_run set status = 'failed', failure_reason = $1, finished_at = now() where status = 'running'", [INTERRUPTED]);
  const count = result.rowCount ?? 0;
  if (count > 0) log(`${count} run(s) left running by a stopped worker marked failed`);
  return count;
}
