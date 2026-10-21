import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMemberReviewJob } from "../src/member-reviews/worker.js";

const report = {
  schemaVersion: "1",
  projectId: "billing",
  unitId: "billing-api/tax/calculate",
  reviewId: "rev_0199abc0-1234-7123-8123-123456789abc",
  generation: 1,
  currentness: "current",
  verdict: "pass",
  reviewedHead: "a".repeat(40),
  reviewedBase: "b".repeat(40),
  mergeBase: "b".repeat(40),
  contextRevision: `sha256:${"1".repeat(64)}`,
  policyRevision: "review-policy-v1",
  agentVersion: "1.0.0",
  coverage: "complete",
  findings: [],
};

describe("review job completion", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function outputDir(): Promise<string> {
    root = await mkdtemp(join(tmpdir(), "kintsugi-review-job-"));
    const out = join(root, "out");
    await mkdir(out);
    return out;
  }

  function store(status: "queued" | "running" = "queued") {
    return {
      findByJobRun: vi.fn(async () => ({ status, reviewId: report.reviewId })),
      markRunning: vi.fn(async () => undefined),
      complete: vi.fn(async () => "succeeded" as const),
      fail: vi.fn(async () => undefined),
    };
  }

  it("persists a bounded report after a successful job and can recover after the runner already finished", async () => {
    const out = await outputDir();
    await writeFile(join(out, "review-report.json"), JSON.stringify(report), "utf8");
    const reviewStore = store("running");
    const run = vi.fn(async () => ({ status: "succeeded" as const }));

    await runMemberReviewJob({ store: reviewStore, run, outputDirectory: () => out }, "job-review");

    expect(run).toHaveBeenCalledOnce();
    expect(reviewStore.complete).toHaveBeenCalledWith("job-review", report);
    expect(reviewStore.fail).not.toHaveBeenCalled();
  });

  it("marks invalid or missing output as failed without publishing a review result", async () => {
    const out = await outputDir();
    await writeFile(join(out, "review-report.json"), "not-json", "utf8");
    const reviewStore = store();
    const run = vi.fn(async () => ({ status: "succeeded" as const }));

    await runMemberReviewJob({ store: reviewStore, run, outputDirectory: () => out }, "job-review");

    expect(reviewStore.complete).not.toHaveBeenCalled();
    expect(reviewStore.fail).toHaveBeenCalledWith("job-review", "INVALID_REPORT_FILE");
  });

  it("records runtime failure and cancellation with stable codes", async () => {
    const out = await outputDir();
    const failedStore = store();
    await runMemberReviewJob({ store: failedStore, run: async () => ({ status: "failed" }), outputDirectory: () => out }, "job-failed");
    expect(failedStore.fail).toHaveBeenCalledWith("job-failed", "JOB_FAILED");

    const cancelledStore = store();
    await runMemberReviewJob({ store: cancelledStore, run: async () => ({ status: "cancelled" }), outputDirectory: () => out }, "job-cancelled");
    expect(cancelledStore.fail).toHaveBeenCalledWith("job-cancelled", "JOB_CANCELLED");
  });

  it("leaves the normal job runner path unchanged for non-review jobs", async () => {
    const run = vi.fn(async () => ({ status: "succeeded" as const }));
    const reviewStore = { ...store(), findByJobRun: vi.fn(async () => undefined) };

    await runMemberReviewJob({ store: reviewStore, run, outputDirectory: () => "unused" }, "ordinary-job");

    expect(run).toHaveBeenCalledOnce();
    expect(reviewStore.markRunning).not.toHaveBeenCalled();
    expect(reviewStore.complete).not.toHaveBeenCalled();
    expect(reviewStore.fail).not.toHaveBeenCalled();
  });
});
