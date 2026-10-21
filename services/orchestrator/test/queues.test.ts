import { describe, expect, it, vi } from "vitest";
import type { PgBoss } from "pg-boss";
import { JOB_RUN_QUEUE, sendJobRun } from "../src/queues.js";

describe("job-run queue delivery", () => {
  it("deduplicates outbox replay and recovery by the durable job-run id", async () => {
    const send = vi.fn(async () => "queue-id");
    const boss = { send } as unknown as PgBoss;

    await sendJobRun(boss, { jobRunId: "job-review-1" });

    expect(send).toHaveBeenCalledWith(JOB_RUN_QUEUE, { jobRunId: "job-review-1" }, { singletonKey: "job-review-1" });
  });
});
