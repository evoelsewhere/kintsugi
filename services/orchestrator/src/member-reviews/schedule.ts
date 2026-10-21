import { createHash, randomUUID } from "node:crypto";
import type { ObservedPullRequest } from "@kintsugi/git";
import type { ReviewContextSnapshot, ReviewInputManifest } from "./inputs.js";

const COMMIT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const CONTEXT_REVISION = /^sha256:[a-f0-9]{64}$/;

export interface ReviewKey {
  projectId: string;
  unitId: string;
  implementationRepositoryId: string;
  provider: "github" | "github-enterprise";
  host: string;
  providerRepositoryId: string;
  pullRequestId: string;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
  /** GitHub does not expose merge-base; the verified local fetch resolves it. */
  mergeBaseSha?: string;
  contextRevision: string;
  policyRevision: string;
  agentVersion: string;
}

export interface ResolvedReviewKey extends ReviewKey {
  mergeBaseSha: string;
}

export type ReviewGenerationReason = "automatic" | "authorized-rerun";
export type ReviewAttemptStatus = "queued" | "running" | "succeeded" | "failed" | "inconclusive";
export type ReviewCurrentness = "current" | "superseded" | "inconclusive";

export interface ReviewAttempt {
  reviewId: string;
  jobRunId: string | null;
  reviewKey: string;
  generation: number;
  status: ReviewAttemptStatus;
  currentness: ReviewCurrentness;
  key: ResolvedReviewKey;
}

export interface ReviewCandidate {
  key: ReviewKey;
  observed: ObservedPullRequest;
  snapshot: ReviewContextSnapshot;
}

export interface ReviewScheduleInput {
  key: ResolvedReviewKey;
  reviewKey: string;
  reason: ReviewGenerationReason;
  reviewId: string;
  jobRunId: string;
  manifest: ReviewInputManifest;
  outputSchema: Record<string, unknown>;
  jobInputs: (attempt: ReviewAttempt) => Record<string, unknown>;
}

export interface ReviewScheduleStore {
  findByKey(reviewKey: string): Promise<ReviewAttempt | undefined>;
  /** Atomically suppresses automatic duplicates, allocates a generation and commits the job/outbox intent. */
  schedule(input: ReviewScheduleInput): Promise<{ created: boolean; attempt: ReviewAttempt }>;
}

export interface ReviewScheduleDependencies {
  store: ReviewScheduleStore;
  outputSchema: Record<string, unknown>;
  prepare(jobRunId: string, key: ReviewKey): Promise<ReviewInputManifest>;
  discard(jobRunId: string): Promise<void>;
}

function validateKey(key: ResolvedReviewKey): void {
  for (const [field, value] of Object.entries({
    projectId: key.projectId,
    unitId: key.unitId,
    implementationRepositoryId: key.implementationRepositoryId,
    host: key.host,
    providerRepositoryId: key.providerRepositoryId,
    pullRequestId: key.pullRequestId,
    policyRevision: key.policyRevision,
    agentVersion: key.agentVersion,
  })) {
    if (value.trim() === "" || value.length > 512) throw new TypeError(`review key ${field} is invalid`);
  }
  if (!Number.isSafeInteger(key.pullRequestNumber) || key.pullRequestNumber < 1 || key.pullRequestNumber > 2_147_483_647) {
    throw new TypeError("review pull request number is invalid");
  }
  if (!COMMIT_ID.test(key.headSha) || !COMMIT_ID.test(key.baseSha) || !COMMIT_ID.test(key.mergeBaseSha)) {
    throw new TypeError("review key revisions must be full commit ids");
  }
  if (!CONTEXT_REVISION.test(key.contextRevision)) throw new TypeError("review key context revision is invalid");
}

/** A canonical key binds every fact that can change the meaning of a review. */
export function reviewKey(key: ResolvedReviewKey): string {
  validateKey(key);
  const stable = {
    projectId: key.projectId,
    unitId: key.unitId,
    implementationRepositoryId: key.implementationRepositoryId,
    provider: key.provider,
    host: key.host.toLowerCase(),
    providerRepositoryId: key.providerRepositoryId,
    pullRequestId: key.pullRequestId,
    pullRequestNumber: key.pullRequestNumber,
    headSha: key.headSha,
    baseSha: key.baseSha,
    mergeBaseSha: key.mergeBaseSha,
    contextRevision: key.contextRevision,
    policyRevision: key.policyRevision,
    agentVersion: key.agentVersion,
  };
  return createHash("sha256").update("kintsugi.member-review.v1\0").update(JSON.stringify(stable)).digest("hex");
}

function assertManifestMatches(manifest: ReviewInputManifest, key: ReviewKey): void {
  if (manifest.projectId !== key.projectId || manifest.unitId !== key.unitId ||
      manifest.contextRevision !== key.contextRevision || manifest.policyRevision !== key.policyRevision ||
      manifest.headSha !== key.headSha || manifest.baseSha !== key.baseSha ||
      (key.mergeBaseSha !== undefined && manifest.mergeBaseSha !== key.mergeBaseSha) ||
      manifest.pullRequest.provider !== key.provider || manifest.pullRequest.host.toLowerCase() !== key.host.toLowerCase() ||
      manifest.pullRequest.repositoryId !== key.providerRepositoryId || manifest.pullRequest.pullRequestId !== key.pullRequestId ||
      manifest.pullRequest.number !== key.pullRequestNumber) {
    throw new Error("materialized review input does not match the immutable review key");
  }
}

function jobInputs(attempt: ReviewAttempt, outputSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    task: [
      `Review ${attempt.key.host}/${attempt.key.providerRepositoryId} pull request #${attempt.key.pullRequestNumber}.`,
      `Review ID: ${attempt.reviewId}. Generation: ${attempt.generation}.`,
      `Pinned head: ${attempt.key.headSha}. Pinned base: ${attempt.key.baseSha}. Merge base: ${attempt.key.mergeBaseSha}.`,
      `Context revision: ${attempt.key.contextRevision}. Policy revision: ${attempt.key.policyRevision}. Reviewer version: ${attempt.key.agentVersion}.`,
      "Read in/review-input.json and every approved source listed there. Review in/changes.patch when it is present. Return currentness as current; Kintsugi rechecks it before storing your result. Write exactly one JSON object to out/result.json using the write tool; the job runner stores that object as review-report.json.",
      "The input coverage is authoritative. Never claim complete coverage or pass if any required input is incomplete. Give each finding a stable ID, impact rationale, concrete repairGuidance, and a citation to a changed or approved-context file with line ranges; do not include source-code excerpts or secrets in findings.",
    ].join("\n"),
    schema: outputSchema,
    resultFile: true,
    resultTo: "review-report.json",
    expectedAgentVersion: attempt.key.agentVersion,
    publishOutput: false,
    disableStalledRetry: true,
  };
}

/** Materializes first, then atomically schedules; duplicate race losers have their input workspace removed. */
export async function scheduleReview(
  deps: ReviewScheduleDependencies,
  key: ReviewKey,
  reason: ReviewGenerationReason,
): Promise<{ created: boolean; attempt: ReviewAttempt }> {
  const knownKeyHash = key.mergeBaseSha === undefined ? undefined : reviewKey({ ...key, mergeBaseSha: key.mergeBaseSha });
  if (reason === "automatic" && knownKeyHash !== undefined) {
    const existing = await deps.store.findByKey(knownKeyHash);
    if (existing !== undefined) return { created: false, attempt: existing };
  }

  const jobRunId = randomUUID();
  const reviewId = `rev_${randomUUID()}`;
  let manifest: ReviewInputManifest;
  try {
    manifest = await deps.prepare(jobRunId, key);
    assertManifestMatches(manifest, key);
  } catch (error) {
    await deps.discard(jobRunId).catch(() => undefined);
    throw error;
  }

  const resolvedKey: ResolvedReviewKey = { ...key, mergeBaseSha: manifest.mergeBaseSha };
  const resolvedKeyHash = reviewKey(resolvedKey);
  if (reason === "automatic" && knownKeyHash === undefined) {
    const existing = await deps.store.findByKey(resolvedKeyHash);
    if (existing !== undefined) {
      await deps.discard(jobRunId);
      return { created: false, attempt: existing };
    }
  }

  try {
    return await deps.store.schedule({
      key: resolvedKey,
      reviewKey: resolvedKeyHash,
      reason,
      reviewId,
      jobRunId,
      manifest,
      outputSchema: deps.outputSchema,
      jobInputs: (attempt) => jobInputs(attempt, deps.outputSchema),
    }).then(async (result) => {
      if (!result.created) await deps.discard(jobRunId);
      return result;
    });
  } catch (error) {
    await deps.discard(jobRunId).catch(() => undefined);
    throw error;
  }
}
