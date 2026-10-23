import { describe, expect, it } from "vitest";
import type { ReviewInputManifest } from "../src/member-reviews/inputs.js";
import { validateReviewReport } from "../src/member-reviews/report.js";
import type { ReviewAttempt, ResolvedReviewKey } from "../src/member-reviews/schedule.js";

const key: ResolvedReviewKey = {
  projectId: "billing",
  unitId: "billing-api/tax/calculate",
  implementationRepositoryId: "repo-code",
  provider: "github",
  host: "github.com",
  providerRepositoryId: "42",
  pullRequestId: "17",
  pullRequestNumber: 17,
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  mergeBaseSha: "b".repeat(40),
  contextRevision: `sha256:${"1".repeat(64)}`,
  policyRevision: "review-policy-v1",
  agentVersion: "1.0.0",
};

const attempt: ReviewAttempt = {
  reviewId: "rev_0199abc0-1234-7123-8123-123456789abc",
  jobRunId: "job-17",
  reviewKey: "f".repeat(64),
  generation: 2,
  status: "running",
  currentness: "current",
  key,
};

const manifest: ReviewInputManifest = {
  schemaVersion: "1",
  projectId: key.projectId,
  unitId: key.unitId,
  snapshotId: "ctx_0199abc0-1234-7123-8123-123456789abc",
  contextRevision: key.contextRevision,
  policyRevision: key.policyRevision,
  pullRequest: { provider: key.provider, host: key.host, repositoryId: key.providerRepositoryId, pullRequestId: key.pullRequestId, number: key.pullRequestNumber },
  headSha: key.headSha,
  baseSha: key.baseSha,
  mergeBaseSha: key.mergeBaseSha,
  changedFileCount: 1,
  changedFiles: [{ path: "src/tax.ts", status: "M", binary: false, generated: false, mode: { old: "100644", next: "100644" } }],
  omittedChangedFileCount: 0,
  patchPath: "changes.patch",
  patchBytes: 50,
  sources: [{ sourceId: "source_design", role: "detailed-design", repositoryId: "docs", commit: "c".repeat(40), path: "design/tax.md", contentHash: `sha256:${"2".repeat(64)}`, inputPath: "context/source-0001.md", required: true }],
  task: { title: "Tax", objective: "Use decimal arithmetic.", acceptanceCriteria: ["Round half up"], requiredDeliverableIds: ["code:tax"] },
  coverage: { status: "complete", generatedFiles: 0, binaryFiles: 0, submodules: 0, symlinks: 0, excludedFiles: [], sourceExclusions: [], incompleteReasons: [] },
};

function report(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const finding = {
    findingId: "tax-rounding-1",
    severity: "high",
    title: "Rounding mode differs from the accepted task",
    rationale: "The implementation uses ties-to-even where the task requires half up.",
    repairGuidance: "Use decimal half-up rounding after summing the invoice lines.",
    citation: { sourceId: "pull-request", path: "src/tax.ts", startLine: 1 },
    currentness: "current",
  };
  return {
    schemaVersion: "1",
    projectId: key.projectId,
    unitId: key.unitId,
    reviewId: attempt.reviewId,
    generation: attempt.generation,
    currentness: "current",
    verdict: "fail",
    reviewedHead: key.headSha,
    reviewedBase: key.baseSha,
    mergeBase: key.mergeBaseSha,
    contextRevision: key.contextRevision,
    policyRevision: key.policyRevision,
    agentVersion: key.agentVersion,
    coverage: "complete",
    findings: [finding],
    ...overrides,
  };
}

describe("review report validation", () => {
  it("accepts only findings cited to materialized changed files or approved context", () => {
    expect(validateReviewReport(report(), attempt, manifest)).toMatchObject({
      reviewId: attempt.reviewId,
      generation: 2,
      findings: [{ citation: { sourceId: "pull-request", path: "src/tax.ts", startLine: 1 } }],
    });
    expect(validateReviewReport(report({ findings: [{
      findingId: "context-1", severity: "medium", title: "Design note", rationale: "The agreed behavior appears in the approved design.",
      repairGuidance: "Use the accepted rounding behavior described in the design.", currentness: "current",
      citation: { sourceId: "source_design", path: "design/tax.md", startLine: 3 },
    }] }), attempt, manifest)).toBeDefined();
    expect(validateReviewReport(report({ findings: [{
      findingId: "outside-1", severity: "high", title: "Uncited path", rationale: "No evidence.", repairGuidance: "Use the cited implementation file.",
      citation: { sourceId: "pull-request", path: "src/secret.ts", startLine: 1 }, currentness: "current",
    }] }), attempt, manifest)).toBeUndefined();
  });

  it("rejects unsupported passing claims, partial coverage claims and stale identities", () => {
    expect(validateReviewReport(report({ verdict: "pass", findings: [] }), attempt, { ...manifest, coverage: { ...manifest.coverage, status: "partial" } })).toBeUndefined();
    expect(validateReviewReport(report({ coverage: "partial" }), attempt, manifest)).toBeUndefined();
    expect(validateReviewReport(report({ generation: 1 }), attempt, manifest)).toBeUndefined();
    expect(validateReviewReport(report({ reviewedHead: "c".repeat(40) }), attempt, manifest)).toBeUndefined();
    expect(validateReviewReport(report({ mergeBase: undefined }), attempt, manifest)).toBeUndefined();
  });
});
