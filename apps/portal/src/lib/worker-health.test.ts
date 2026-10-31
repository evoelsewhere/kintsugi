import { describe, expect, it } from "vitest";
import type { WorkerHealth, WorkerStatus } from "./api/monitoring";
import { splitWorkers, workerVerdict } from "./worker-health";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const ago = (hours: number): string => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

const worker = (id: string, state: WorkerStatus["state"], lastSeenAt: string): WorkerStatus => ({
  workerId: id,
  host: "host",
  pid: 1,
  version: "1",
  startedAt: lastSeenAt,
  lastSeenAt,
  secondsSinceSeen: 0,
  activeJobs: 0,
  queues: [],
  state,
});

describe("workerVerdict", () => {
  it("says the counts are jobs of every queue, not stage runs", () => {
    const health: WorkerHealth = {
      up: true,
      workersUp: 1,
      queues: [
        { name: "job-run", queued: 0, active: 0, deferred: 0 },
        { name: "git-sync", queued: 3, active: 3, deferred: 1 },
      ],
    };
    expect(workerVerdict(health, NOW).detail).toBe("1 worker up · 3 jobs active · 3 jobs queued, in all queues");
  });
});

describe("splitWorkers", () => {
  it("lists running workers and those seen in the last day; older stopped ones only on request", () => {
    const { current, stopped } = splitWorkers(
      [worker("up", "up", ago(0)), worker("recent", "stopped", ago(2)), worker("stale", "stale", ago(30)), worker("old", "stopped", ago(24 * 9))],
      NOW,
    );
    expect(current.map((entry) => entry.workerId)).toEqual(["up", "recent"]);
    expect(stopped.map((entry) => entry.workerId)).toEqual(["stale", "old"]);
  });
});
