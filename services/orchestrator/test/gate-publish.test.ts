import { describe, expect, it, vi } from "vitest";
import { formatGateRecord, unitGateReviewPath, type GateEvidence } from "@kintsugi/domain";
import type { OutboxOperation } from "../src/outbox/model.js";
import { publishGate } from "../src/gates/publish.js";

const sha = (char: string): string => char.repeat(40);
const evidence: GateEvidence = {
  schemaVersion: "1",
  decisionId: "gate_" + "a".repeat(48),
  projectId: "shop",
  unitId: "web/core/invoice",
  gateId: "G4",
  decision: "approved",
  auditEventId: "1842",
  policyRevision: "member-context-v1",
  contextRevision: `sha256:${"b".repeat(64)}`,
  requiredDeliverableIds: ["code", "docs"],
  actor: { userId: "user-1", authorizationId: `session:${"c".repeat(64)}` },
  deliverables: [
    { deliverableId: "code", repositoryId: "api", pullRequestId: "pr-1", reviewResultId: "rev-1", reviewedRevision: sha("d"), mergedRevision: sha("e") },
    { deliverableId: "docs", repositoryId: "docs", pullRequestId: "pr-2", reviewResultId: "rev-2", reviewedRevision: sha("f"), mergedRevision: sha("1") },
  ],
};

function operation(content = formatGateRecord(evidence)): OutboxOperation {
  return {
    operationId: "outbox-1",
    transitionKey: evidence.decisionId,
    projectId: evidence.projectId,
    queue: "document-write",
    intentKey: "publish-gate-record",
    attempts: 1,
    payload: {
      documentRepositoryId: "docs",
      request: {
        writeId: evidence.decisionId,
        projectId: evidence.projectId,
        kind: "state-change",
        message: "Publish G4 decision for web/core/invoice",
        files: [{ path: unitGateReviewPath("web", "core", "invoice", "G4"), content }],
        actor: "admin",
        unit: evidence.unitId,
        reviewAll: true,
      },
    },
  };
}

describe("gate record outbox publication", () => {
  it("queues only the exact validated decision record as a reviewed write", async () => {
    const enqueue = vi.fn(async () => undefined);
    const result = await publishGate({ enqueue }, operation());

    expect(result).toMatchObject({ status: "queued", operationId: "outbox-1" });
    expect(enqueue).toHaveBeenCalledWith("docs", expect.objectContaining({
      writeId: evidence.decisionId,
      reviewAll: true,
      files: [{ path: unitGateReviewPath("web", "core", "invoice", "G4"), content: formatGateRecord(evidence) }],
    }));
  });

  it("rejects mismatched gate content before handing anything to the document writer", async () => {
    const enqueue = vi.fn(async () => undefined);
    await expect(publishGate({ enqueue }, operation("# forged gate record"))).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
