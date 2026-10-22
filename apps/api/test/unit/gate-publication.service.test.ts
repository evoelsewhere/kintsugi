import { describe, expect, it, vi } from "vitest";
import type { Actor } from "../../src/common/auth/decorators.js";
import { GatePublicationService } from "../../src/modules/governance/gate-publication/application/gate-publication.service.js";
import type { GateDecisionEvidenceReader } from "../../src/modules/governance/gate-publication/domain/gate-decision-evidence.reader.js";
import type { GatePublicationRepository } from "../../src/modules/governance/gate-publication/domain/gate-publication.repository.js";
import type { GateDeliverableEvidence } from "@kintsugi/domain";

const actor: Actor = { id: "user-1", username: "admin", permissions: ["gates.decide"] };
const authorizationId = `session:${"a".repeat(64)}`;
const context = {
  projectId: "shop",
  unitId: "web/core/invoice",
  contextRevision: `sha256:${"b".repeat(64)}`,
  policyRevision: "member-context-v1",
  requiredDeliverableIds: ["code", "docs"],
  requiredDeliverables: [
    { id: "code", repositoryId: "api", path: "src/invoice.ts" },
    { id: "docs", repositoryId: "docs", path: "10-applications/web/02-modern/core/invoice/detail/logic.md" },
  ],
};
const deliverables: GateDeliverableEvidence[] = [
  { deliverableId: "code", repositoryId: "api", pullRequestId: "pr-1", reviewResultId: "rev-1", reviewedRevision: "c".repeat(40), mergedRevision: "d".repeat(40) },
  { deliverableId: "docs", repositoryId: "docs", pullRequestId: "pr-2", reviewResultId: "rev-2", reviewedRevision: "e".repeat(40), mergedRevision: "f".repeat(40) },
];

function fixture(evidence: GateDeliverableEvidence[] = deliverables) {
  const createDecision = vi.fn(async (input: Parameters<GatePublicationRepository["createDecision"]>[0]) => ({
    decisionId: input.evidence.decisionId,
    projectId: input.evidence.projectId,
    unitId: input.evidence.unitId,
    gateId: input.evidence.gateId,
    decision: input.evidence.decision,
    state: "pending-publication" as const,
    evidenceHash: input.evidenceHash,
    recordPath: input.recordPath,
    documentWriteId: input.evidence.decisionId,
    documentWriteStatus: "queued",
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
  }));
  const reader = { readCompletedDeliverables: vi.fn(async () => evidence) } as unknown as GateDecisionEvidenceReader;
  const projectAccess = { requireRead: vi.fn(async () => undefined) };
  const snapshots = { currentGateContext: vi.fn(async () => context) };
  const projects = { getProject: vi.fn(async () => ({ documentRepository: { repositoryId: "docs" } })) };
  const get = vi.fn(async () => ({ projectId: "shop" }));
  const repository = { createDecision, get } as unknown as GatePublicationRepository;
  const service = new GatePublicationService(repository, reader, snapshots as never, projects as never, projectAccess as never);
  return { service, createDecision, get, reader, projectAccess, snapshots, projects };
}

describe("GatePublicationService", () => {
  it("requires current Project Access to read gate publication status", async () => {
    const state = fixture();
    state.projectAccess.requireRead.mockRejectedValue(new Error("Project Access is required"));
    await expect(state.service.get("decision", actor)).rejects.toThrow("Project Access is required");
  });
  it("binds source paths to the decision so implementation outputs can replace design deliverables", async () => {
    const state = fixture();
    await state.service.requestDecision(actor, authorizationId, { projectId: "shop", unitId: "web/core/invoice", gateId: "G2", decision: "approved" });
    expect(state.createDecision.mock.calls[0]?.[0].evidence.deliverables[1]).toMatchObject({ path: context.requiredDeliverables[1]!.path });
  });
  it("does not treat a database decision as effective when current merged evidence is missing", async () => {
    const state = fixture([deliverables[0]!]);
    const result = await state.service.requestDecision(actor, authorizationId, {
      projectId: "shop", unitId: "web/core/invoice", gateId: "G4", decision: "approved",
    });

    expect(result).toMatchObject({ state: "awaiting-evidence", missingDeliverableIds: ["docs"] });
    expect(state.createDecision).not.toHaveBeenCalled();
  });

  it("binds an authorized session decision to the current context and exact evidence manifest", async () => {
    const state = fixture();
    const first = await state.service.requestDecision(actor, authorizationId, {
      projectId: "shop", unitId: "web/core/invoice", gateId: "G4", decision: "approved",
    });
    const second = await state.service.requestDecision(actor, authorizationId, {
      projectId: "shop", unitId: "web/core/invoice", gateId: "G4", decision: "approved",
    });
    const captured = state.createDecision.mock.calls[0]?.[0];

    expect(first).toMatchObject({ state: "pending-publication", projectId: "shop", unitId: "web/core/invoice" });
    if (first.state === "awaiting-evidence" || second.state === "awaiting-evidence") throw new Error("complete evidence unexpectedly returned blockers");
    expect(second).toMatchObject({ decisionId: first.decisionId });
    expect(captured?.evidence).toMatchObject({
      decision: "approved",
      contextRevision: context.contextRevision,
      policyRevision: context.policyRevision,
      requiredDeliverableIds: ["code", "docs"],
      actor: { userId: "user-1", authorizationId },
    });
    expect(captured?.audit.detail).toMatchObject({ evidenceHash: captured?.evidenceHash, authorizationId, gateId: "G4" });
    expect(captured?.recordPath).toBe("10-applications/web/02-modern/core/invoice/reviews/G4.md");
  });

  it("refuses a member token even when the token owner has the gate permission", async () => {
    const state = fixture();
    await expect(state.service.requestDecision(actor, "knt_pat_read_only", {
      projectId: "shop", unitId: "web/core/invoice", gateId: "G4", decision: "approved",
    })).rejects.toMatchObject({ status: 403 });
    expect(state.reader.readCompletedDeliverables).not.toHaveBeenCalled();
  });
});
