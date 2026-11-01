import { describe, expect, it } from "vitest";
import { limitConcurrency } from "#common/util/async.js";

describe("limitConcurrency", () => {
  it("runs at most `max` tasks at once, the others wait their turn, and a failure frees its place", async () => {
    const limit = limitConcurrency(2);
    let running = 0;
    let most = 0;
    const releases: Array<() => void> = [];
    const task = (fail: boolean) => () =>
      new Promise<string>((resolve, reject) => {
        running++;
        most = Math.max(most, running);
        releases.push(() => {
          running--;
          if (fail) reject(new Error("failed"));
          else resolve("done");
        });
      });
    const results = [limit(task(true)), limit(task(false)), limit(task(false)), limit(task(false)), limit(task(false))].map((promise) => promise.catch((error: Error) => error.message));
    for (let round = 0; round < 5; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(running).toBeLessThanOrEqual(2);
      releases.shift()?.();
    }
    expect(await Promise.all(results)).toEqual(["failed", "done", "done", "done", "done"]);
    expect(most).toBe(2);
  });
});
