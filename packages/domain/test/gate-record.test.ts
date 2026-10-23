import { describe, expect, it } from "vitest";
import { formatGateRecord, parseGateRecord } from "../src/gate-record.js";

const evidence = {
  schemaVersion: "1" as const,
  decisionId: "gate-decision-001",
  projectId: "shop",
  unitId: "web/core/invoice",
  gateId: "G4",
  decision: "approved" as const,
  auditEventId: "1842",
  policyRevision: "review-policy-v1",
  contextRevision: `sha256:${"a".repeat(64)}`,
  requiredDeliverableIds: ["invoice-code"],
  actor: { userId: "user-1", authorizationId: `session:${"b".repeat(64)}` },
  deliverables: [{
    deliverableId: "invoice-code",
    repositoryId: "target-repo",
    pullRequestId: "pr-77",
    reviewResultId: "rev_018f0000-0000-4000-8000-000000000077",
    reviewedRevision: "c".repeat(40),
    mergedRevision: "d".repeat(40),
  }],
};

describe("evidence-bound gate records", () => {
  it("round-trips validated machine evidence inside a readable Markdown record", () => {
    const markdown = formatGateRecord(evidence);

    expect(markdown).toContain("# Gate G4 — web/core/invoice");
    expect(markdown).toContain("Decision: approved");
    expect(markdown).toContain("<!-- kintsugi-gate-evidence:v1 -->");
    expect(parseGateRecord(markdown)).toEqual({ status: "valid", evidence });
  });

  it("rejects missing, duplicate, malformed, or tampered evidence blocks", () => {
    const valid = formatGateRecord(evidence);
    expect(parseGateRecord("# Gate G4\n- Decision: approved")).toMatchObject({ status: "invalid" });
    expect(parseGateRecord(valid + "\n<!-- kintsugi-gate-evidence:v1 -->\n{}\n<!-- /kintsugi-gate-evidence -->")).toMatchObject({ status: "invalid" });
    expect(parseGateRecord(valid.replace('"mergedRevision": "dddddddddddddddddddddddddddddddddddddddd"', '"mergedRevision": "not-a-revision"'))).toMatchObject({ status: "invalid" });
    expect(parseGateRecord(valid.replace("- Decision: approved", "- Decision: rejected"))).toMatchObject({ status: "invalid", code: "GATE_RECORD_SUMMARY" });
  });

  it("publishes a waived deliverable with its exact scope and immutable reason", () => {
    const waived = {
      ...evidence,
      decision: "waived" as const,
      requiredDeliverableIds: ["invoice-code", "invoice-design"],
      waiver: {
        deliverableIds: ["invoice-code"],
        reason: "The code artifact is intentionally deferred under the signed exception.",
      },
      deliverables: [{ ...evidence.deliverables[0]!, deliverableId: "invoice-design" }],
    };
    const markdown = formatGateRecord(waived);

    expect(markdown).toContain("- Waived deliverables: invoice-code");
    expect(markdown).toContain("- Waiver reason: \"The code artifact is intentionally deferred under the signed exception.\"");
    expect(parseGateRecord(markdown)).toEqual({ status: "valid", evidence: waived });
  });
});
