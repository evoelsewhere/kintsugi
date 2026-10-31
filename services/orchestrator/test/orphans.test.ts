// Runs left `running` by a dead worker are failed when a worker starts, unless another worker is alive.

import { hostname } from "node:os";
import { describe, expect, it } from "vitest";
import { INTERRUPTED, failOrphanedRuns, sweepOrphanedRuns } from "../src/orphans.js";

function fakePool(alive: boolean, updated: number) {
  const row = { host: alive ? "another-host" : hostname(), pid: 999_999_999 };
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    pool: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return sql.startsWith("select") ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: updated };
      },
    } as never,
  };
}

describe("orphaned runs", () => {
  it("fails the running runs when no other worker is alive", async () => {
    const { pool, queries } = fakePool(false, 2);
    const logs: string[] = [];
    expect(await failOrphanedRuns(pool, (message) => logs.push(message))).toBe(2);
    expect(queries[1]?.sql).toContain("set status = 'failed'");
    expect(queries[1]?.params).toEqual([INTERRUPTED]);
    expect(logs).toHaveLength(1);
  });

  it("leaves them alone while another worker beats", async () => {
    const { pool, queries } = fakePool(true, 2);
    expect(await failOrphanedRuns(pool, () => undefined)).toBe(0);
    expect(queries).toHaveLength(1);
  });
});

describe("orphaned runs after a recreate (T3-009)", () => {
  /** A pool whose heartbeat query says another worker is alive for the first `aliveFor` sweeps. */
  function sequencedPool(aliveFor: number) {
    let sweeps = 0;
    const updates: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith("select now()")) return { rows: [{ at: "2026-11-01T03:00:00Z" }], rowCount: 1 };
        if (sql.startsWith("select")) {
          sweeps += 1;
          return { rows: [{ host: sweeps <= aliveFor ? "another-host" : hostname(), pid: 999_999_999 }], rowCount: 1 };
        }
        updates.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    } as never;
    return { pool, updates };
  }
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it("sweeps once more after a fresh heartbeat has gone stale, failing only runs started before this worker", async () => {
    const { pool, updates } = sequencedPool(1);
    await sweepOrphanedRuns(pool, () => undefined, 50);
    expect(updates).toHaveLength(0);
    await wait(150);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.sql).toContain("started_at < $2");
    expect(updates[0]?.params).toEqual([INTERRUPTED, "2026-11-01T03:00:00Z"]);
  });

  it("sweeps at once when no other worker is alive, and leaves the runs alone while another one keeps beating", async () => {
    const now = sequencedPool(0);
    await sweepOrphanedRuns(now.pool, () => undefined, 50);
    expect(now.updates).toHaveLength(1);
    expect(now.updates[0]?.sql).not.toContain("started_at");
    const beating = sequencedPool(5);
    await sweepOrphanedRuns(beating.pool, () => undefined, 50);
    await wait(150);
    expect(beating.updates).toHaveLength(0);
  });

  it("cancels the second sweep when the worker stops", async () => {
    const { pool, updates } = sequencedPool(1);
    const cancel = await sweepOrphanedRuns(pool, () => undefined, 50);
    cancel();
    await wait(150);
    expect(updates).toHaveLength(0);
  });
});
