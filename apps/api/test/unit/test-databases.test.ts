// The integration harness never leaves a throwaway database behind (T1-014): it drops it even when closing the app
// hangs, and a later run sweeps only its own old databases.

import { describe, expect, it, vi } from "vitest";
import { STALE_TEST_DATABASE_MS, closeThenDrop, staleTestDatabases, testDatabaseName } from "../support/database.js";

const HOUR = 60 * 60 * 1000;

describe("test databases", () => {
  it("drops the database when closing the app hangs or fails, then reports the failure", async () => {
    const drop = vi.fn(async () => undefined);
    const pool = vi.fn(async () => undefined);
    const hanging = (): Promise<void> => new Promise(() => undefined);
    await expect(closeThenDrop([hanging, pool], drop, 50)).rejects.toThrow(/more than 50 ms/);
    expect(pool).toHaveBeenCalledOnce();
    expect(drop).toHaveBeenCalledOnce();

    const failing = vi.fn(async () => undefined);
    await expect(closeThenDrop([async () => { throw new Error("close failed"); }], failing, 50)).rejects.toThrow("close failed");
    expect(failing).toHaveBeenCalledOnce();
    await expect(closeThenDrop([async () => undefined], undefined, 50)).resolves.toBeUndefined();
  });

  it("sweeps only its own databases older than six hours, never the configured one", () => {
    const now = Date.UTC(2026, 10, 1, 12);
    const old = testDatabaseName(now - STALE_TEST_DATABASE_MS - HOUR);
    const recent = testDatabaseName(now - HOUR);
    const configured = testDatabaseName(now - 10 * HOUR);
    expect(old).toMatch(/^kintsugi_api_test_[0-9a-z]+_[0-9a-f]{8}$/);
    const names = [old, recent, configured, "kintsugi_api_test_1a2b3c4d", "kintsugi", "kintsugi_api_test_zzzzzz_12345678x", "postgres"];
    expect(staleTestDatabases(names, now, configured)).toEqual([old]);
    // At exactly six hours a run may still hold it.
    expect(staleTestDatabases([testDatabaseName(now - STALE_TEST_DATABASE_MS)], now, undefined)).toEqual([]);
  });
});
