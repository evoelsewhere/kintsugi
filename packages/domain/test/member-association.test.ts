import { describe, expect, it } from "vitest";
import { parseMemberAssociationClaim, readMemberAssociationContext, validateMemberAssociationClaimForTask } from "../src/member-association.js";

const validClaim = {
  projectId: "billing-modernization",
  unitId: "billing-api/payments/invoice-validation",
  contextRevision: `sha256:${"a".repeat(64)}`,
  deliverableIds: ["invoice-api", "invoice-tests"],
};
const bodyFor = (value: unknown) => `Implementation notes\n\n<!-- kintsugi:task-association\n${JSON.stringify(value)}\n-->`;

describe("member PR association claim", () => {
  it("parses only the bounded documented Kintsugi body block", () => {
    expect(parseMemberAssociationClaim(bodyFor(validClaim))).toEqual({ status: "valid", claim: validClaim });
    expect(parseMemberAssociationClaim("plain PR description")).toEqual({ status: "absent" });
    expect(parseMemberAssociationClaim({ body: bodyFor(validClaim) })).toEqual({ status: "invalid" });
  });

  it.each([
    ["duplicate blocks", `${bodyFor(validClaim)}\n${bodyFor(validClaim)}`],
    ["invalid project id", bodyFor({ ...validClaim, projectId: "../other" })],
    ["bad context digest", bodyFor({ ...validClaim, contextRevision: "sha256:bad" })],
    ["duplicate deliverables", bodyFor({ ...validClaim, deliverableIds: ["invoice-api", "invoice-api"] })],
    ["empty unit path segment", bodyFor({ ...validClaim, unitId: "billing-api//invoice" })],
  ])("marks %s as invalid without returning a partial claim", (_name, body) => {
    expect(parseMemberAssociationClaim(body)).toEqual({ status: "invalid" });
  });

  it("rejects oversized bodies and metadata blocks before JSON parsing", () => {
    expect(parseMemberAssociationClaim("x".repeat(100_001))).toEqual({ status: "invalid" });
    expect(parseMemberAssociationClaim(`<!-- kintsugi:task-association\n${"x".repeat(8_193)}\n-->`)).toEqual({ status: "invalid" });
  });

  it("validates a claim against the project, task, pinned context, base branch and declared deliverables", () => {
    const input = {
      claim: validClaim,
      projectId: validClaim.projectId,
      unitId: validClaim.unitId,
      repositoryId: "billing-code",
      baseRef: "main",
      defaultBranch: "main",
      contextRevision: validClaim.contextRevision,
      requiredDeliverableIds: ["invoice-api", "invoice-tests"],
      deliverables: [
        { id: "invoice-api", repositoryId: "billing-code" },
        { id: "invoice-tests", repositoryId: "billing-code" },
      ],
    };
    expect(validateMemberAssociationClaimForTask(input)).toEqual({ valid: true });
    expect(validateMemberAssociationClaimForTask({ ...input, repositoryId: "docs-repo" })).toEqual({ valid: false, reason: "deliverables-mismatch" });
    expect(validateMemberAssociationClaimForTask({ ...input, baseRef: "release" })).toEqual({ valid: false, reason: "target-branch-mismatch" });
    expect(validateMemberAssociationClaimForTask({ ...input, contextRevision: `sha256:${"b".repeat(64)}` })).toEqual({ valid: false, reason: "context-mismatch" });
    expect(validateMemberAssociationClaimForTask({ ...input, unitId: "billing-api/payments/other" })).toEqual({ valid: false, reason: "task-mismatch" });
    expect(validateMemberAssociationClaimForTask({ ...input, requiredDeliverableIds: ["invoice-tests"] })).toEqual({ valid: false, reason: "deliverables-mismatch" });
  });

  it("reads the task deliverable contract from a pinned snapshot without trusting malformed JSON", () => {
    expect(readMemberAssociationContext({
      contextRevision: validClaim.contextRevision,
      manifest: { requiredDeliverableIds: ["invoice-api"] },
      task: { requiredDeliverables: [{ id: "invoice-api", repositoryId: "billing-code", path: "src/invoice.ts" }] },
    })).toEqual({
      contextRevision: validClaim.contextRevision,
      requiredDeliverableIds: ["invoice-api"],
      deliverables: [{ id: "invoice-api", repositoryId: "billing-code" }],
    });
    expect(readMemberAssociationContext({
      contextRevision: validClaim.contextRevision,
      manifest: { requiredDeliverableIds: ["invoice-api", "invoice-api"] },
      task: { requiredDeliverables: [{ id: "invoice-api", repositoryId: "billing-code" }] },
    })).toBeUndefined();
  });
});
