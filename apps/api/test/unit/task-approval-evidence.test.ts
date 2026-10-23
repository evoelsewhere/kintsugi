import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { formatGateRecord, gateEvidenceCanonicalJson, type GateEvidence } from "@kintsugi/domain";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/common/db/pool.js", () => ({ getPool: () => ({ query }) }));

import { PgTaskApprovalEvidenceReader } from "../../src/modules/delivery/agent-context/infrastructure/pg-task-approval-evidence.reader.js";
import type { DocumentsService } from "../../src/modules/delivery/documents/index.js";

const evidence: GateEvidence = {
  schemaVersion: "1",
  decisionId: "gate_" + "a".repeat(48),
  projectId: "shop",
  unitId: "web/core/invoice",
  gateId: "G2",
  decision: "approved",
  auditEventId: "1842",
  policyRevision: "member-context-v1",
  contextRevision: `sha256:${"b".repeat(64)}`,
  requiredDeliverableIds: ["design"],
  actor: { userId: "architect-1", authorizationId: `session:${"c".repeat(64)}` },
  deliverables: [{
    deliverableId: "design",
    repositoryId: "shop-docs",
    pullRequestId: "pr-7",
    reviewResultId: "rev-7",
    reviewedRevision: "d".repeat(40),
    mergedRevision: "e".repeat(40),
  }],
};
const record = {
  decision_id: evidence.decisionId,
  project_id: evidence.projectId,
  unit_id: evidence.unitId,
  gate_id: evidence.gateId,
  decision: evidence.decision,
  state: "effective",
  evidence,
  evidence_hash: createHash("sha256").update(gateEvidenceCanonicalJson(evidence)).digest("hex"),
  record_path: "10-applications/web/02-modern/core/invoice/reviews/G2.md",
  record_commit: "f".repeat(40),
  document_repository_id: "shop-docs",
  deliverable_path: "10-applications/web/02-modern/core/invoice/detail/logic.md",
  deliverable_revision: "e".repeat(40),
};

function reader(options: { text?: string; ancestor?: boolean } = {}) {
  const documents = {
    context: vi.fn(async () => ({ repo: { repositoryId: "shop-docs" } })),
    readText: vi.fn(async (_context, _revision, path: string) => {
      if (path === record.record_path) return options.text ?? formatGateRecord(evidence);
      if (path === record.deliverable_path) return "approved design";
      return undefined;
    }),
    isAncestor: vi.fn(async () => options.ancestor ?? true),
  } as unknown as DocumentsService;
  return { reader: new PgTaskApprovalEvidenceReader(documents), documents };
}

describe("verified task approval evidence", () => {
  beforeEach(() => query.mockReset());

  it("recognizes a predecessor gate only when the effective record exists in the indexed commit", async () => {
    query.mockResolvedValue({ rows: [record] });
    const state = reader();

    await expect(state.reader.predecessorStatus("shop", "web/core/invoice", "G2", "1".repeat(40))).resolves.toBe("approved");
    expect(state.documents.isAncestor).toHaveBeenCalledWith(expect.anything(), record.record_commit, "1".repeat(40));
  });

  it("does not treat typed Markdown or a record outside the indexed commit as approval", async () => {
    query.mockResolvedValue({ rows: [record] });
    const forged = reader({ text: "# Gate G2 — web/core/invoice\n\n- Decision: approved\n- Decided by user ID: architect-1" });
    await expect(forged.reader.predecessorStatus("shop", "web/core/invoice", "G2", "1".repeat(40))).resolves.toBe("unknown");

    const futureRecord = reader({ ancestor: false });
    await expect(futureRecord.reader.predecessorStatus("shop", "web/core/invoice", "G2", "1".repeat(40))).resolves.toBe("unknown");
  });

  it("approves a required source only through an effective record at the task's pinned commit", async () => {
    query.mockResolvedValue({ rows: [record] });
    const state = reader();

    await expect(state.reader.sourceApproval("shop", "10-applications/web/02-modern/core/invoice/detail/logic.md", "1".repeat(40))).resolves.toBe("approved");
    expect(query.mock.calls[0]?.[0]).toContain("deliverable.value->>'path'");
  });
});
