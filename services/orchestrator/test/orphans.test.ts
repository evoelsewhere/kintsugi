// Runs left `running` by a dead worker are failed when a worker starts, unless another worker is alive.

import { hostname } from "node:os";
import { describe, expect, it } from "vitest";
import { INTERRUPTED, failOrphanedRuns } from "../src/orphans.js";

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
