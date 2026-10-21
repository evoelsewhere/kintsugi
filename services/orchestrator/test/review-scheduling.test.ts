import { describe, expect, it } from "vitest";
import type { ReviewInputManifest } from "../src/member-reviews/inputs.js";
import { reviewKey, scheduleReview, type ResolvedReviewKey, type ReviewAttempt, type ReviewKey, type ReviewScheduleStore } from "../src/member-reviews/schedule.js";

const sha = (character: string): string => character.repeat(40);

function key(overrides: Partial<ResolvedReviewKey> = {}): ResolvedReviewKey {
  return {
    projectId: "billing",
    unitId: "billing/tax/calculate",
    implementationRepositoryId: "repo-code",
    provider: "github",
    host: "github.com",
    providerRepositoryId: "42",
    pullRequestId: "17",
    pullRequestNumber: 17,
    headSha: sha("a"),
    baseSha: sha("b"),
    mergeBaseSha: sha("b"),
    contextRevision: `sha256:${"1".repeat(64)}`,
    policyRevision: "review-policy-v1",
    agentVersion: "1.0.0",
    ...overrides,
  };
}

function manifest(value: ResolvedReviewKey): ReviewInputManifest {
  return {
    schemaVersion: "1",
    projectId: value.projectId,
    unitId: value.unitId,
    snapshotId: "ctx_0199abc0-1234-7123-8123-123456789abc",
    contextRevision: value.contextRevision,
    policyRevision: value.policyRevision,
    pullRequest: { provider: value.provider, host: value.host, repositoryId: value.providerRepositoryId, pullRequestId: value.pullRequestId, number: value.pullRequestNumber },
    headSha: value.headSha,
    baseSha: value.baseSha,
    mergeBaseSha: value.mergeBaseSha,
    changedFileCount: 1,
    changedFiles: [{ path: "src/tax.ts", status: "M", binary: false, generated: false, mode: { old: "100644", next: "100644" } }],
    omittedChangedFileCount: 0,
    patchPath: "changes.patch",
    patchBytes: 50,
    sources: [],
    task: { title: "Tax", objective: "Use decimal math", acceptanceCriteria: [], requiredDeliverableIds: ["code:tax"] },
    coverage: { status: "complete", generatedFiles: 0, binaryFiles: 0, submodules: 0, symlinks: 0, excludedFiles: [], sourceExclusions: [], incompleteReasons: [] },
  };
}

class MemoryStore implements ReviewScheduleStore {
  readonly attempts: ReviewAttempt[] = [];
  readonly jobInputs: Array<Record<string, unknown>> = [];

  async findByKey(keyHash: string): Promise<ReviewAttempt | undefined> {
    return this.attempts.filter((attempt) => attempt.reviewKey === keyHash).sort((left, right) => right.generation - left.generation)[0];
  }

  async schedule(input: Parameters<ReviewScheduleStore["schedule"]>[0]): ReturnType<ReviewScheduleStore["schedule"]> {
    const existing = await this.findByKey(input.reviewKey);
    if (input.reason === "automatic" && existing !== undefined) return { created: false, attempt: existing };
    const generation = Math.max(0, ...this.attempts.filter((attempt) => samePullRequest(attempt.key, input.key)).map((attempt) => attempt.generation)) + 1;
    for (const attempt of this.attempts) if (samePullRequest(attempt.key, input.key) && attempt.currentness === "current") attempt.currentness = "superseded";
    const attempt: ReviewAttempt = {
      reviewId: input.reviewId,
      jobRunId: input.jobRunId,
      reviewKey: input.reviewKey,
      generation,
      status: "queued",
      currentness: "current",
      key: input.key,
    };
    this.jobInputs.push(input.jobInputs(attempt));
    this.attempts.push(attempt);
    return { created: true, attempt };
  }
}

function samePullRequest(left: ReviewKey, right: ReviewKey): boolean {
  return left.host === right.host && left.providerRepositoryId === right.providerRepositoryId && left.pullRequestId === right.pullRequestId;
}

describe("revision-bound review scheduling", () => {
  it("hashes every revision, context, policy and agent version into a stable identity", () => {
    const value = key();
    expect(reviewKey(value)).toBe(reviewKey({ ...value }));
    expect(reviewKey(value)).not.toBe(reviewKey({ ...value, headSha: sha("c") }));
    expect(reviewKey(value)).not.toBe(reviewKey({ ...value, contextRevision: `sha256:${"2".repeat(64)}` }));
    expect(reviewKey(value)).not.toBe(reviewKey({ ...value, policyRevision: "review-policy-v2" }));
    expect(reviewKey(value)).not.toBe(reviewKey({ ...value, agentVersion: "1.1.0" }));
  });

  it("binds a missing provider merge base to the merge base resolved from fetched Git objects", async () => {
    const store = new MemoryStore();
    const value = key();
    const { mergeBaseSha: _mergeBaseSha, ...withoutMergeBase } = value;
    const result = await scheduleReview({
      store,
      outputSchema: { type: "object" },
      prepare: async (_jobRunId, preparedKey) => manifest({ ...preparedKey, mergeBaseSha: value.mergeBaseSha }),
      discard: async () => undefined,
    }, withoutMergeBase, "automatic");

    expect(result.created).toBe(true);
    expect(result.attempt.key.mergeBaseSha).toBe(value.mergeBaseSha);
    expect(result.attempt.reviewKey).toBe(reviewKey({ ...withoutMergeBase, mergeBaseSha: value.mergeBaseSha }));
  });

  it("schedules an unchanged revision once, makes an authorized rerun a new generation, and supersedes an old head", async () => {
    const store = new MemoryStore();
    const prepared: string[] = [];
    const discarded: string[] = [];
    const deps = {
      store,
      outputSchema: { type: "object", required: ["schemaVersion"] },
      prepare: async (jobRunId: string, value: ReviewKey) => { prepared.push(jobRunId); return manifest({ ...value, mergeBaseSha: value.mergeBaseSha ?? sha("b") }); },
      discard: async (jobRunId: string) => { discarded.push(jobRunId); },
    };
    const first = await scheduleReview(deps, key(), "automatic");
    const duplicate = await scheduleReview(deps, key(), "automatic");
    const rerun = await scheduleReview(deps, key(), "authorized-rerun");
    const pushed = await scheduleReview(deps, key({ headSha: sha("c") }), "automatic");

    expect(first).toMatchObject({ created: true, attempt: { generation: 1, status: "queued" } });
    expect(duplicate).toMatchObject({ created: false, attempt: { reviewId: first.attempt.reviewId, generation: 1 } });
    expect(rerun).toMatchObject({ created: true, attempt: { generation: 2 } });
    expect(pushed).toMatchObject({ created: true, attempt: { generation: 3 } });
    expect(first.attempt.currentness).toBe("superseded");
    expect(rerun.attempt.currentness).toBe("superseded");
    expect(pushed.attempt.currentness).toBe("current");
    expect(prepared).toHaveLength(3);
    expect(discarded).toHaveLength(0);
    expect(store.jobInputs[0]).toMatchObject({ expectedAgentVersion: "1.0.0", resultFile: true, resultTo: "review-report.json", publishOutput: false, disableStalledRetry: true });
  });

  it("discards pre-materialized inputs when a concurrent duplicate wins or identity verification fails", async () => {
    const store = new MemoryStore();
    const discarded: string[] = [];
    const value = key();
    const deps = {
      store,
      outputSchema: { type: "object" },
      prepare: async (_jobRunId: string) => { await store.schedule({ key: value, reviewKey: reviewKey(value), reason: "automatic", reviewId: "race-winner", jobRunId: "winner-job", manifest: manifest(value), outputSchema: {}, jobInputs: () => ({}) }); return manifest(value); },
      discard: async (jobRunId: string) => { discarded.push(jobRunId); },
    };

    const duplicate = await scheduleReview(deps, value, "automatic");
    expect(duplicate).toMatchObject({ created: false, attempt: { reviewId: "race-winner" } });
    expect(discarded).toHaveLength(1);

    const bad = { ...deps, prepare: async () => manifest({ ...value, headSha: sha("c") }) };
    await expect(scheduleReview(bad, value, "authorized-rerun")).rejects.toThrow(/does not match/);
    expect(discarded).toHaveLength(2);
  });
});
