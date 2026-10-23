import { describe, expect, it } from "vitest";
import * as domain from "../src/index.js";

type CheckEvidence = {
  id: string;
  name: string;
  appId?: string;
  evaluatedRevision: string;
  runAttempt?: number;
  startedAt?: string;
  status: string;
  conclusion?: string;
};

type ReviewEvidence = {
  id: string;
  reviewerId?: string;
  state: string;
  commitSha?: string;
  submittedAt?: string;
};

type ReviewEvidenceInput = {
  contextRevision: string;
  observedHeadSha: string;
  evaluatedRevision: string;
  coverage: "complete" | "partial";
  observationComplete: boolean;
  checks: readonly CheckEvidence[];
  reviews: readonly ReviewEvidence[];
};

type ReviewPolicy = {
  contextRevision: string;
  expectedHeadSha: string;
  evaluatedRevision: string;
  requiredChecks: readonly { name: string; producerAppId: string }[];
  requiredApprovals: number;
  authorizedReviewerIds: readonly string[];
  latestReviewablePush: boolean;
};

type EvidenceVerdict = { status: "satisfied" | "unsatisfied" | "inconclusive"; unmetRequirements: string[] };
type Evaluator = (input: ReviewEvidenceInput, policy: ReviewPolicy) => EvidenceVerdict;

const head = "a".repeat(40);
const otherHead = "b".repeat(40);
const contextRevision = `sha256:${"c".repeat(64)}`;
const now = "2026-10-21T10:00:00.000Z";
const evaluate = (domain as unknown as Record<string, unknown>)["evaluateReviewEvidence"] as Evaluator | undefined;

function currentEvidence(overrides: Partial<ReviewEvidenceInput> = {}): ReviewEvidenceInput {
  return {
    contextRevision,
    observedHeadSha: head,
    evaluatedRevision: head,
    coverage: "complete",
    observationComplete: true,
    checks: [{ id: "check-1", name: "unit-tests", appId: "app-12", evaluatedRevision: head, runAttempt: 1, startedAt: now, status: "completed", conclusion: "success" }],
    reviews: [{ id: "review-1", reviewerId: "user-7", state: "APPROVED", commitSha: head, submittedAt: now }],
    ...overrides,
  };
}

function currentPolicy(overrides: Partial<ReviewPolicy> = {}): ReviewPolicy {
  return {
    contextRevision,
    expectedHeadSha: head,
    evaluatedRevision: head,
    requiredChecks: [{ name: "unit-tests", producerAppId: "app-12" }],
    requiredApprovals: 1,
    authorizedReviewerIds: ["user-7"],
    latestReviewablePush: true,
    ...overrides,
  };
}

describe("trusted review evidence policy", () => {
  it("accepts only the named producer's latest successful check and an authorized current-head approval", () => {
    expect(typeof evaluate).toBe("function");
    const result = evaluate!(currentEvidence(), currentPolicy());
    expect(result).toEqual({ status: "satisfied", unmetRequirements: [] });
  });

  it("does not accept a same-named success from the wrong producer", () => {
    expect(typeof evaluate).toBe("function");
    const result = evaluate!(currentEvidence({ checks: [{ ...currentEvidence().checks[0]!, appId: "app-evil" }] }), currentPolicy());
    expect(result.status).toBe("unsatisfied");
    expect(result.unmetRequirements).toContain("checks.unit-tests.expected-producer");
  });

  it.each(["skipped", "neutral", "failure"])("requires an executed successful latest check result (%s)", (conclusion) => {
    expect(typeof evaluate).toBe("function");
    const oldSuccess = currentEvidence().checks[0]!;
    const latest = { ...oldSuccess, id: "check-2", runAttempt: 2, startedAt: "2026-10-21T10:01:00.000Z", conclusion };
    const result = evaluate!(currentEvidence({ checks: [oldSuccess, latest] }), currentPolicy());
    expect(result.status).toBe("unsatisfied");
    expect(result.unmetRequirements).toContain("checks.unit-tests.successful-execution");
  });

  it("keeps the approved PR head distinct from the commit evaluated by required checks", () => {
    expect(typeof evaluate).toBe("function");
    const testMergeSha = "e".repeat(40);
    const evidence = currentEvidence({
      evaluatedRevision: testMergeSha,
      checks: [{ ...currentEvidence().checks[0]!, evaluatedRevision: testMergeSha }],
      reviews: [{ ...currentEvidence().reviews[0]!, commitSha: head }],
    });
    const result = evaluate!(evidence, currentPolicy({ evaluatedRevision: testMergeSha }));
    expect(result).toEqual({ status: "satisfied", unmetRequirements: [] });
  });
  it("orders GitHub-style checks by start time when run-attempt numbers are unavailable", () => {
    expect(typeof evaluate).toBe("function");
    const oldSuccess = currentEvidence().checks[0]!;
    const { runAttempt: _runAttempt, ...githubCheck } = oldSuccess;
    const latest = { ...githubCheck, id: "check-2", startedAt: "2026-10-21T10:01:00.000Z", conclusion: "skipped" };
    const result = evaluate!(currentEvidence({ checks: [githubCheck, latest] }), currentPolicy());
    expect(result.status).toBe("unsatisfied");
    expect(result.unmetRequirements).toContain("checks.unit-tests.successful-execution");
  });

  it("treats partially missing attempt ordering as inconclusive", () => {
    expect(typeof evaluate).toBe("function");
    const current = currentEvidence().checks[0]!;
    const withoutAttempt = { ...current, id: "check-2", runAttempt: undefined, startedAt: "2026-10-21T10:01:00.000Z" };
    const result = evaluate!(currentEvidence({ checks: [current, withoutAttempt] }), currentPolicy());
    expect(result.status).toBe("inconclusive");
    expect(result.unmetRequirements).toContain("checks.unit-tests.latest-attempt-known");
  });

  it("does not count dismissed, old-head, or unauthorized human approvals", () => {
    expect(typeof evaluate).toBe("function");
    const result = evaluate!(currentEvidence({ reviews: [
      { id: "dismissed", reviewerId: "user-8", state: "DISMISSED", commitSha: head, submittedAt: now },
      { id: "old-head", reviewerId: "user-7", state: "APPROVED", commitSha: otherHead, submittedAt: now },
      { id: "unauthorized", reviewerId: "outsider", state: "APPROVED", commitSha: head, submittedAt: now },
    ] }), currentPolicy());
    expect(result.status).toBe("unsatisfied");
    expect(result.unmetRequirements).toContain("reviews.required-authorized-approvals");
    expect(result.unmetRequirements).toContain("reviews.latest-reviewable-push");
  });

  it("does not let an unauthorized approval satisfy the authority requirement", () => {
    expect(typeof evaluate).toBe("function");
    const result = evaluate!(currentEvidence({ reviews: [
      { id: "outsider", reviewerId: "outsider", state: "APPROVED", commitSha: head, submittedAt: now },
    ] }), currentPolicy());
    expect(result.status).toBe("unsatisfied");
    expect(result.unmetRequirements).toContain("reviews.authority");
    expect(result.unmetRequirements).toContain("reviews.required-authorized-approvals");
  });

  it("uses each authorized reviewer's latest review and ignores superseded approvals", () => {
    expect(typeof evaluate).toBe("function");
    const result = evaluate!(currentEvidence({ reviews: [
      { id: "stale", reviewerId: "user-7", state: "APPROVED", commitSha: otherHead, submittedAt: "2026-10-21T09:00:00.000Z" },
      { id: "current", reviewerId: "user-7", state: "APPROVED", commitSha: head, submittedAt: now },
      { id: "outsider", reviewerId: "outsider", state: "APPROVED", commitSha: head, submittedAt: now },
    ] }), currentPolicy());
    expect(result).toEqual({ status: "satisfied", unmetRequirements: [] });
  });

  it("marks stale heads, context, partial coverage, and incomplete provider observations inconclusive", () => {
    expect(typeof evaluate).toBe("function");
    const stale = evaluate!(currentEvidence({ observedHeadSha: otherHead }), currentPolicy());
    expect(stale.status).toBe("inconclusive");
    expect(stale.unmetRequirements).toContain("pull-request.current-head");

    const changedContext = evaluate!(currentEvidence({ contextRevision: `sha256:${"d".repeat(64)}` }), currentPolicy());
    expect(changedContext.status).toBe("inconclusive");
    expect(changedContext.unmetRequirements).toContain("context.revision");

    const partial = evaluate!(currentEvidence({ coverage: "partial", observationComplete: false }), currentPolicy());
    expect(partial.status).toBe("inconclusive");
    expect(partial.unmetRequirements).toEqual(expect.arrayContaining(["review.coverage.complete", "provider.observation.complete"]));
  });
});
