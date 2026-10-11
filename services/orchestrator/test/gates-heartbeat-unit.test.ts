// The heartbeat and gate polling against a recording fake pool (no database): what is written
// when, that a failed beat never throws, and that waiting ends on a decision.

import { describe, expect, it } from "vitest";
import { waitForGate } from "../src/gates.js";
import { startHeartbeat } from "../src/heartbeat.js";

type Query = { sql: string; params: unknown[] };

function fakePool(answer: (sql: string, params: unknown[]) => unknown[] = () => []) {
  const queries: Query[] = [];
  return {
    queries,
    pool: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return { rows: answer(sql, params), rowCount: 0 };
      },
    } as never,
  };
}

describe("worker heartbeat", () => {
  it("forgets old rows, upserts on start and marks the row stopped", async () => {
    const { pool, queries } = fakePool();
    const heartbeat = await startHeartbeat({ pool, queues: ["git-sync"], activeJobs: () => 3, intervalSeconds: 3600, workerId: "w-1", version: "9.9.9", log: () => undefined });
    expect(heartbeat.workerId).toBe("w-1");
    expect(queries[0]?.sql).toContain("delete from workflow.worker_heartbeat");
    expect(queries[1]?.sql).toContain("insert into workflow.worker_heartbeat");
    expect(queries[1]?.params).toEqual(["w-1", expect.any(String), process.pid, "9.9.9", expect.any(Date), 3, ["git-sync"]]);

    await heartbeat.stop();
    expect(queries.at(-1)?.sql).toContain("set stopped_at = now()");
    const count = queries.length;
    await heartbeat.beat(); // no beats after stop
    await heartbeat.stop(); // idempotent
    expect(queries.length).toBe(count);
  });

  it("logs a failed beat instead of throwing", async () => {
    const messages: string[] = [];
    const pool = {
      query: async () => {
        throw new Error("connection refused");
      },
    } as never;
    const heartbeat = await startHeartbeat({ pool, queues: [], activeJobs: () => 0, intervalSeconds: 3600, log: (message) => messages.push(message) });
    await heartbeat.stop();
    expect(messages).toEqual(["could not remove old heartbeats: connection refused", "heartbeat failed: connection refused", "could not mark the heartbeat stopped: connection refused"]);
  });
});

describe("waiting for a gate", () => {
  it("polls until the gate is decided", async () => {
    let polls = 0;
    const { pool } = fakePool(() => {
      polls += 1;
      return [{ id: "g-1", status: polls < 3 ? "pending" : "waived", decided_by: polls < 3 ? null : "lead", decided_at: polls < 3 ? null : new Date(0), note: polls < 3 ? null : "Accepted risk" }];
    });
    await expect(waitForGate(pool, "g-1", { intervalMs: 5 })).resolves.toEqual({ id: "g-1", status: "waived", decidedBy: "lead", decidedAt: new Date(0).toISOString(), note: "Accepted risk" });
    expect(polls).toBe(3);
  });

  it("fails when the gate disappears", async () => {
    const { pool } = fakePool(() => []);
    await expect(waitForGate(pool, "gone", { intervalMs: 5 })).rejects.toThrow("Gate gone no longer exists");
  });
});
