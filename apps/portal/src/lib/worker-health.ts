// The worker's state as the portal shows it from the monitoring overview: its heartbeat first
// (ADR-0030: up when seen less than 45 s ago), then its queue counts and whether queued runs wait
// too long.

import type { StatusTone } from "@/components/ui/status-dot";
import type { WorkerHealth } from "./api/monitoring";
import { formatRelative } from "./format";

/** What the worker is doing, judged from its heartbeat, its queues and how long queued runs have waited. */
export function workerVerdict(worker: WorkerHealth, now: number = Date.now()): { tone: StatusTone; label: string; detail: string } {
  if (!worker.up) {
    return {
      tone: "red",
      label: "Not running",
      detail: worker.lastSeenAt === undefined ? "No worker has sent a heartbeat yet. Start kintsugi-worker." : `Last heartbeat ${formatRelative(worker.lastSeenAt, now)}. Check that the worker is running.`,
    };
  }
  const workers = worker.workersUp === 1 ? "1 worker" : `${worker.workersUp} workers`;
  const oldestQueued = worker.oldestQueuedRunAt === undefined ? undefined : now - new Date(worker.oldestQueuedRunAt).getTime();
  if (oldestQueued !== undefined && oldestQueued > 10 * 60 * 1000) {
    return { tone: "orange", label: "Not picking up runs", detail: `${workers} up, but a run has been queued since ${formatRelative(worker.oldestQueuedRunAt, now)}.` };
  }
  if (worker.queues === null) return { tone: "green", label: "Up", detail: `${workers} up · queue counts unavailable` };
  const active = worker.queues.reduce((total, queue) => total + queue.active, 0);
  const queued = worker.queues.reduce((total, queue) => total + queue.queued, 0);
  if (active > 0) return { tone: "blue", label: "Working", detail: `${workers} up · ${active} active · ${queued} queued` };
  return { tone: "green", label: "Idle", detail: `${workers} up · ${queued > 0 ? `${queued} queued` : "nothing queued"}` };
}
