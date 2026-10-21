import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { pruneMemberEvents } from "../src/member-event-retention.js";

describe("pruneMemberEvents", () => {
  it("deletes bounded batches outside the seven-day replay window", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rowCount: 17, rows: [] }));

    await expect(pruneMemberEvents({ query } as unknown as Pick<Pool, "query">)).resolves.toBe(17);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("now() - interval '7 days'"), [1_000]);
    expect(query.mock.calls[0]?.[0]).toContain("for update skip locked");
  });

  it("treats a driver with no rowCount as a successful empty cleanup", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }));

    await expect(pruneMemberEvents({ query } as unknown as Pick<Pool, "query">)).resolves.toBe(0);
  });
});
