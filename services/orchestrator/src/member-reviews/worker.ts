import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { JobRun, JobStatus } from "../jobs/model.js";
import type { ReviewAttempt } from "./schedule.js";

const REVIEW_RESULT_FILE = "review-report.json";
const MAX_REVIEW_RESULT_BYTES = 8 * 1024 * 1024;

export interface ReviewJobExecutionStore {
  findByJobRun(jobRunId: string): Promise<Pick<ReviewAttempt, "reviewId" | "status"> | undefined>;
  markRunning(jobRunId: string): Promise<unknown>;
  complete(jobRunId: string, report: unknown): Promise<"succeeded" | "inconclusive" | "failed">;
  fail(jobRunId: string, failureCode: string): Promise<void>;
}

export interface ReviewJobExecutionDependencies {
  store: ReviewJobExecutionStore;
  run(jobRunId: string, signal?: AbortSignal): Promise<Pick<JobRun, "status"> | undefined>;
  outputDirectory(jobRunId: string): string;
}

async function readReviewReport(outDirectory: string): Promise<{ value?: unknown; failureCode?: string }> {
  const path = join(outDirectory, REVIEW_RESULT_FILE);
  let file;
  try {
    file = await lstat(path);
  } catch (error) {
    return { failureCode: (error as NodeJS.ErrnoException).code === "ENOENT" ? "REVIEW_REPORT_MISSING" : "INVALID_REPORT_FILE" };
  }
  if (!file.isFile() || file.isSymbolicLink() || file.size < 2 || file.size > MAX_REVIEW_RESULT_BYTES) {
    return { failureCode: "INVALID_REPORT_FILE" };
  }
  try {
    const text = await readFile(path, "utf8");
    return { value: JSON.parse(text) as unknown };
  } catch {
    return { failureCode: "INVALID_REPORT_FILE" };
  }
}

/** Runs a generic job, then records a review result only after revalidating it in the store. */
export async function runMemberReviewJob(
  deps: ReviewJobExecutionDependencies,
  jobRunId: string,
  signal?: AbortSignal,
): Promise<void> {
  const review = await deps.store.findByJobRun(jobRunId);
  if (review === undefined) {
    await deps.run(jobRunId, signal);
    return;
  }
  if (review.status === "succeeded" || review.status === "failed" || review.status === "inconclusive") return;
  if (review.status === "queued") await deps.store.markRunning(jobRunId);

  let run: Pick<JobRun, "status"> | undefined;
  try {
    run = await deps.run(jobRunId, signal);
  } catch {
    await deps.store.fail(jobRunId, "JOB_RUNNER_ERROR");
    throw new Error("member review job runner failed");
  }
  if (run === undefined) {
    await deps.store.fail(jobRunId, "JOB_RUN_MISSING");
    return;
  }
  if (run.status === "queued" || run.status === "running") return;
  if (run.status === "failed" || run.status === "cancelled") {
    await deps.store.fail(jobRunId, run.status === "cancelled" ? "JOB_CANCELLED" : "JOB_FAILED");
    return;
  }
  if (run.status !== "succeeded") {
    const _exhaustive: JobStatus = run.status;
    await deps.store.fail(jobRunId, "JOB_FAILED");
    return;
  }

  const result = await readReviewReport(deps.outputDirectory(jobRunId));
  if (result.failureCode !== undefined) {
    await deps.store.fail(jobRunId, result.failureCode);
    return;
  }
  await deps.store.complete(jobRunId, result.value);
}
