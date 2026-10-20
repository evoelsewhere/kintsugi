import { describe, expect, it } from "vitest";
import { validateGateEvidence } from "../src/index.js";

const sha = (char: string): string => char.repeat(40);

const approvedEvidence = {
  schemaVersion: "1",
  decisionId: "decision-001",
  projectId: "modernization",
  unitId: "billing/invoices/tax",
  gateId: "G4",
  decision: "approved",
  auditEventId: "audit-001",
  policyRevision: "policy-v3",
  contextRevision: `sha256:${"a".repeat(64)}`,
  requiredDeliverableIds: ["code", "design"],
  actor: {
    userId: "user-001",
    authorizationId: "authz-001",
  },
  deliverables: [
    {
      deliverableId: "code",
      repositoryId: "billing-api",
      pullRequestId: "pr-101",
      reviewResultId: "review-101",
      reviewedRevision: sha("b"),
      mergedRevision: sha("c"),
    },
    {
      deliverableId: "design",
      repositoryId: "project-docs",
      pullRequestId: "pr-102",
      reviewResultId: "review-102",
      reviewedRevision: sha("d"),
      mergedRevision: sha("e"),
    },
  ],
};

describe("gate evidence contract", () => {
  it("validates evidence for every required deliverable and exact revisions", () => {
    const result = validateGateEvidence(approvedEvidence);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requiredDeliverableIds).toEqual(["code", "design"]);
      expect(result.value.deliverables[0]?.mergedRevision).toBe(sha("c"));
    }
  });

  it("does not accept an actor name as authorization evidence", () => {
    const { userId: _userId, authorizationId: _authorizationId, ...nameOnly } = approvedEvidence.actor;
    const result = validateGateEvidence({
      ...approvedEvidence,
      actor: { ...nameOnly, name: "Maintainer" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path.startsWith("actor"))).toBe(true);
  });

  it("rejects missing, duplicate or unpinned deliverables", () => {
    const missing = validateGateEvidence({
      ...approvedEvidence,
      deliverables: approvedEvidence.deliverables.slice(0, 1),
    });
    const duplicate = validateGateEvidence({
      ...approvedEvidence,
      deliverables: [approvedEvidence.deliverables[0], approvedEvidence.deliverables[0]],
    });
    const unpinned = validateGateEvidence({
      ...approvedEvidence,
      deliverables: [{ ...approvedEvidence.deliverables[0], mergedRevision: "main" }, approvedEvidence.deliverables[1]],
    });

    expect(missing.ok).toBe(false);
    expect(duplicate.ok).toBe(false);
    expect(unpinned.ok).toBe(false);
  });
});
