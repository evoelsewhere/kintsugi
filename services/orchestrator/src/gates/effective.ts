import { createHash } from "node:crypto";
import { gateEvidenceCanonicalJson, parseGateRecord, type GateDeliverableEvidence, type GateEvidence, type GateRecordParseResult, type GitLocation } from "@kintsugi/domain";

export interface GateAuditProof {
  id: string;
  action: string;
  actor: string;
  projectId?: string;
  subject?: string;
  detail: Record<string, unknown>;
}

export interface GateDeliverableFact {
  deliverableId: string;
  repositoryId: string;
  pullRequestId: string;
  state: "open" | "closed" | "merged";
  authorProviderActorId?: string;
  headSha: string;
  mergeCommitSha?: string;
  review: {
    reviewId: string;
    currentness: "current" | "superseded" | "inconclusive";
    verdict: "pass" | "fail" | "inconclusive";
    coverage: "complete" | "partial";
    reviewedHead: string;
    contextRevision: string;
    policyRevision: string;
  };
  authorizedHumanApproval?: {
    reviewerId: string;
    providerActorId: string;
    reviewedHead: string;
    state: string;
    hasProjectAccess: boolean;
  };
}

export interface GateEffectiveDependencies {
  readRecord(location: GitLocation): Promise<string | undefined>;
  auditEvent(auditEventId: string): Promise<GateAuditProof | undefined>;
  currentContext(projectId: string, unitId: string): Promise<{
    contextRevision: string;
    policyRevision: string;
    requiredDeliverableIds: readonly string[];
  } | undefined>;
  deliverable(evidence: GateDeliverableEvidence): Promise<GateDeliverableFact | undefined>;
}

export type EffectiveGateResult =
  | { status: "effective"; evidence: GateEvidence }
  | { status: "awaiting-evidence"; code: "GATE_AUDIT_MISSING" | "DELIVERABLE_UNAVAILABLE" | "DELIVERABLE_NOT_MERGED" | "HUMAN_APPROVAL_MISSING" }
  | { status: "stale"; code: "CONTEXT_CHANGED" | "DELIVERABLE_SET_CHANGED" | "DELIVERABLE_HEAD_CHANGED" | "MERGED_REVISION_CHANGED" }
  | { status: "invalid"; code: string }
  | { status: "rejected" };

const invalid = (code: string): EffectiveGateResult => ({ status: "invalid", code });

/** Revalidate a merged gate record against authenticated audit, current task policy and live provider facts. */
export async function verifyEffectiveGate(deps: GateEffectiveDependencies, location: GitLocation): Promise<EffectiveGateResult> {
  const markdown = await deps.readRecord(location);
  if (markdown === undefined) return invalid("GATE_RECORD_MISSING");
  const parsed: GateRecordParseResult = parseGateRecord(markdown);
  if (parsed.status !== "valid") return invalid(parsed.code);
  const evidence = parsed.evidence;

  const audit = await deps.auditEvent(evidence.auditEventId);
  const evidenceHash = createHash("sha256").update(gateEvidenceCanonicalJson(evidence)).digest("hex");
  if (audit === undefined) return { status: "awaiting-evidence", code: "GATE_AUDIT_MISSING" };
  if (audit.id !== evidence.auditEventId || audit.action !== "gate.decision.request" || audit.actor !== evidence.actor.userId ||
      audit.projectId !== evidence.projectId || audit.subject !== evidence.decisionId ||
      audit.detail["authorizationId"] !== evidence.actor.authorizationId || audit.detail["gateId"] !== evidence.gateId ||
      audit.detail["decision"] !== evidence.decision || audit.detail["contextRevision"] !== evidence.contextRevision ||
      audit.detail["policyRevision"] !== evidence.policyRevision || audit.detail["evidenceHash"] !== evidenceHash) return invalid("GATE_AUDIT_MISMATCH");
  if (evidence.decision === "waived" && (evidence.waiver === undefined ||
      JSON.stringify(audit.detail["waiverDeliverableIds"]) !== JSON.stringify(evidence.waiver.deliverableIds) ||
      audit.detail["waiverReason"] !== evidence.waiver.reason)) return invalid("GATE_WAIVER_AUDIT_MISMATCH");
  if (evidence.decision !== "waived" && (audit.detail["waiverDeliverableIds"] !== undefined || audit.detail["waiverReason"] !== undefined)) {
    return invalid("GATE_WAIVER_AUDIT_MISMATCH");
  }
  if (evidence.decision === "rejected") return { status: "rejected" };

  const current = await deps.currentContext(evidence.projectId, evidence.unitId);
  if (current === undefined) return { status: "stale", code: "CONTEXT_CHANGED" };
  if (current.contextRevision !== evidence.contextRevision || current.policyRevision !== evidence.policyRevision) {
    return { status: "stale", code: "CONTEXT_CHANGED" };
  }
  const expectedIds = [...current.requiredDeliverableIds].sort();
  const recordedIds = [...evidence.requiredDeliverableIds].sort();
  if (expectedIds.length !== recordedIds.length || expectedIds.some((id, index) => id !== recordedIds[index])) {
    return { status: "stale", code: "DELIVERABLE_SET_CHANGED" };
  }

  for (const item of evidence.deliverables) {
    const fact = await deps.deliverable(item);
    if (fact === undefined) return { status: "awaiting-evidence", code: "DELIVERABLE_UNAVAILABLE" };
    if (fact.deliverableId !== item.deliverableId || fact.repositoryId !== item.repositoryId || fact.pullRequestId !== item.pullRequestId) {
      return invalid("DELIVERABLE_IDENTITY_MISMATCH");
    }
    if (fact.state !== "merged" || fact.mergeCommitSha === undefined) {
      return { status: "awaiting-evidence", code: "DELIVERABLE_NOT_MERGED" };
    }
    if (fact.headSha !== item.reviewedRevision || fact.review.reviewedHead !== item.reviewedRevision) {
      return { status: "stale", code: "DELIVERABLE_HEAD_CHANGED" };
    }
    if (fact.mergeCommitSha !== item.mergedRevision) return { status: "stale", code: "MERGED_REVISION_CHANGED" };
    if (fact.review.reviewId !== item.reviewResultId || fact.review.currentness !== "current" || fact.review.verdict !== "pass" ||
        fact.review.coverage !== "complete" || fact.review.contextRevision !== evidence.contextRevision ||
        fact.review.policyRevision !== evidence.policyRevision) return invalid("REVIEW_EVIDENCE_MISMATCH");
    if (fact.authorizedHumanApproval === undefined || fact.authorizedHumanApproval.reviewerId.trim() === "" ||
        fact.authorizedHumanApproval.providerActorId.trim() === "" || fact.authorizedHumanApproval.state !== "APPROVED" ||
        !fact.authorizedHumanApproval.hasProjectAccess ||
        fact.authorizedHumanApproval.providerActorId === fact.authorProviderActorId ||
        fact.authorizedHumanApproval.reviewedHead !== item.reviewedRevision) {
      return { status: "awaiting-evidence", code: "HUMAN_APPROVAL_MISSING" };
    }
  }
  return { status: "effective", evidence };
}
