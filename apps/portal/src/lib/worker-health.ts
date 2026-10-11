// The worker's state as the portal judges it from the monitoring overview: its queue counts,
// and whether queued runs wait too long (the worker publishes no heartbeat of its own).

import type { StatusTone } from "@/components/ui/status-dot";
import type { WorkerHealth } from "./api/monitoring";
import { formatRelative } from "./format";

/** What the worker is doing, judged from its queues and how long queued runs have waited. */
export function workerVerdict(worker: WorkerHealth, now: number = Date.now()): { tone: StatusTone; label: string; detail: string } {
  const oldestQueued = worker.oldestQueuedRunAt === undefined ? undefined : now - new Date(worker.oldestQueuedRunAt).getTime();
  if (oldestQueued !== undefined && oldestQueued > 10 * 60 * 1000) {
    return { tone: "orange", label: "Not picking up runs", detail: `A run has been queued since ${formatRelative(worker.oldestQueuedRunAt, now)}. Check that the worker is running.` };
  }
  if (worker.queues === null) return { tone: "muted", label: "Unknown", detail: "The queue counts could not be read." };
  const active = worker.queues.reduce((total, queue) => total + queue.active, 0);
  const queued = worker.queues.reduce((total, queue) => total + queue.queued, 0);
  if (active > 0) return { tone: "blue", label: "Working", detail: `${active} active · ${queued} queued` };
  return { tone: "green", label: "Idle", detail: queued > 0 ? `${queued} queued` : "Nothing queued" };
}
