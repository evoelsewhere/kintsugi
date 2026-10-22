import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { formatGateRecord, gateEvidenceCanonicalJson, type GateEvidence, type GitLocation } from "@kintsugi/domain";
import { verifyEffectiveGate, type GateAuditProof, type GateDeliverableFact } from "../src/gates/effective.js";

const sha = (char: string): string => char.repeat(40);
const evidence: GateEvidence = {
  schemaVersion: "1",
  decisionId: "decision-001",
  projectId: "shop",
  unitId: "web/core/invoice",
  gateId: "G4",
  decision: "approved",
  auditEventId: "1842",
  policyRevision: "policy-v1",
  contextRevision: `sha256:${"a".repeat(64)}`,
  requiredDeliverableIds: ["code"],
  actor: { userId: "user-1", authorizationId: `session:${"b".repeat(64)}` },
  deliverables: [{
    deliverableId: "code",
    repositoryId: "target",
    pullRequestId: "pr-7",
    reviewResultId: "review-7",
    reviewedRevision: sha("c"),
    mergedRevision: sha("d"),
  }],
};
const location: GitLocation = { repo: "docs", commit: sha("e"), path: "10-applications/web/02-modern/core/invoice/reviews/G4.md" };
const evidenceHash = createHash("sha256").update(gateEvidenceCanonicalJson(evidence)).digest("hex");
const audit: GateAuditProof = {
  id: "1842",
  action: "gate.decision.request",
  actor: "user-1",
  projectId: "shop",
  subject: "decision-001",
  detail: {
    authorizationId: evidence.actor.authorizationId,
    gateId: "G4",
    decision: "approved",
    contextRevision: evidence.contextRevision,
    policyRevision: evidence.policyRevision,
    evidenceHash,
  },
};
const fact: GateDeliverableFact = {
  deliverableId: "code",
  repositoryId: "target",
  pullRequestId: "pr-7",
  state: "merged",
  headSha: sha("c"),
  mergeCommitSha: sha("d"),
  review: {
    reviewId: "review-7",
    currentness: "current",
    verdict: "pass",
    coverage: "complete",
    reviewedHead: sha("c"),
    contextRevision: evidence.contextRevision,
    policyRevision: evidence.policyRevision,
  },
  authorProviderActorId: "provider-author",
  authorizedHumanApproval: {
    reviewerId: "reviewer-1",
    providerActorId: "provider-reviewer",
    serverId: "github",
    reviewedHead: sha("c"),
    state: "APPROVED",
    hasProjectAccess: true,
  },
};

function dependencies(options: {
  audit?: GateAuditProof | null;
  recordText?: string;
  currentHead?: string;
  requiredDeliverableIds?: string[];
  state?: "open" | "closed" | "merged";
} = {}) {
  const visited: string[] = [];
  return {
    visited,
    deps: {
      async readRecord() { return options.recordText ?? formatGateRecord(evidence); },
      async auditEvent() { return options.audit === undefined ? audit : options.audit ?? undefined; },
      async currentContext() {
        return {
          contextRevision: evidence.contextRevision,
          policyRevision: evidence.policyRevision,
          requiredDeliverableIds: options.requiredDeliverableIds ?? ["code"],
        };
      },
      async deliverable(item: GateEvidence["deliverables"][number]) {
        visited.push(item.deliverableId);
        return {
          ...fact,
          ...(options.currentHead === undefined ? {} : { headSha: options.currentHead }),
          ...(options.state === undefined ? {} : { state: options.state }),
        };
      },
    },
  };
}

describe("effective gate verification", () => {
  it("rejects a gate record listed as its own deliverable", async () => {
    const self = { ...evidence, deliverables: [{ ...evidence.deliverables[0]!, repositoryId: "docs", path: location.path }] };
    const state = dependencies({ recordText: formatGateRecord(self), audit: { ...audit, detail: { ...audit.detail, evidenceHash: createHash("sha256").update(gateEvidenceCanonicalJson(self)).digest("hex") } } });
    state.deps.deliverable = async () => ({ ...fact, repositoryId: "docs" });
    await expect(verifyEffectiveGate(state.deps, location)).resolves.toMatchObject({ status: "invalid", code: "GATE_SELF_DEPENDENCY" });
  });
  it("requires the authenticated audit proof; Markdown actor text is not authority", async () => {
    const { deps } = dependencies({ audit: null });
    await expect(verifyEffectiveGate(deps, location)).resolves.toMatchObject({
      status: "awaiting-evidence",
      code: "GATE_AUDIT_MISSING",
    });

    const spoofed = dependencies({ audit: { ...audit, actor: "someone-else" } });
    await expect(verifyEffectiveGate(spoofed.deps, location)).resolves.toMatchObject({ status: "invalid", code: "GATE_AUDIT_MISMATCH" });
  });

  it("stales a decision when a replacement head differs from the reviewed revision", async () => {
    const { deps } = dependencies({ currentHead: sha("f") });
    await expect(verifyEffectiveGate(deps, location)).resolves.toMatchObject({ status: "stale", code: "DELIVERABLE_HEAD_CHANGED" });
  });

  it("requires exact required deliverables and their final provider merge revisions", async () => {
    const changedSet = dependencies({ requiredDeliverableIds: ["code", "docs"] });
    await expect(verifyEffectiveGate(changedSet.deps, location)).resolves.toMatchObject({ status: "stale", code: "DELIVERABLE_SET_CHANGED" });
    const unmerged = dependencies({ state: "open" });
    await expect(verifyEffectiveGate(unmerged.deps, location)).resolves.toMatchObject({ status: "awaiting-evidence" });
  });

  it("verifies only the declared deliverable PRs, so the gate-record PR cannot wait on its own G4", async () => {
    const { deps, visited } = dependencies();
    await expect(verifyEffectiveGate(deps, location)).resolves.toMatchObject({ status: "effective" });
    expect(visited).toEqual(["code"]);
  });

  it("does not count the PR author or an unmapped reviewer as the required human approval", async () => {
    const { deps } = dependencies();
    const unauthorized = {
      ...deps,
      async deliverable() {
        return {
          ...fact,
          authorProviderActorId: "provider-user-1",
          authorizedHumanApproval: {
            reviewerId: "provider-user-1",
            providerActorId: "provider-user-1",
            reviewedHead: sha("c"),
            state: "APPROVED",
            hasProjectAccess: false,
          },
        } as unknown as GateDeliverableFact;
      },
    };

    await expect(verifyEffectiveGate(unauthorized, location)).resolves.toMatchObject({
      status: "awaiting-evidence",
      code: "HUMAN_APPROVAL_MISSING",
    });
  });

  it("makes a scoped, audited waiver effective only for the waived required deliverable", async () => {
    const waivedEvidence: GateEvidence = {
      ...evidence,
      decision: "waived",
      requiredDeliverableIds: ["code", "docs"],
      waiver: { deliverableIds: ["docs"], reason: "The docs artifact is approved through the retained architecture record." },
    };
    const waivedAudit: GateAuditProof = {
      ...audit,
      detail: {
        authorizationId: waivedEvidence.actor.authorizationId,
        gateId: "G4",
        decision: "waived",
        contextRevision: waivedEvidence.contextRevision,
        policyRevision: waivedEvidence.policyRevision,
        evidenceHash: createHash("sha256").update(gateEvidenceCanonicalJson(waivedEvidence)).digest("hex"),
        waiverDeliverableIds: ["docs"],
        waiverReason: waivedEvidence.waiver?.reason,
      },
    };
    const deps = {
      async readRecord() { return formatGateRecord(waivedEvidence); },
      async auditEvent() { return waivedAudit; },
      async currentContext() {
        return {
          contextRevision: evidence.contextRevision,
          policyRevision: evidence.policyRevision,
          requiredDeliverableIds: ["code", "docs"],
        };
      },
      async deliverable(item: GateEvidence["deliverables"][number]) {
        expect(item.deliverableId).toBe("code");
        return fact;
      },
    };

    await expect(verifyEffectiveGate(deps, location)).resolves.toMatchObject({
      status: "effective",
      evidence: { decision: "waived", waiver: { deliverableIds: ["docs"] } },
    });
  });
});
