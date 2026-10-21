import { createHash } from "node:crypto";
import { gateEvidenceCanonicalJson, parseGateRecord, validateGateEvidence, type GateDeliverableEvidence, type GateEvidence, type GateRecordParseResult, type GitLocation } from "@kintsugi/domain";

import { recordTransition } from "../outbox/store.js";

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
  if (evidence.deliverables.some(item => item.repositoryId === location.repo && item.path === location.path)) return invalid("GATE_SELF_DEPENDENCY");

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

export interface GatePublicationCandidate {
  decision_id: string;
  project_id: string;
  unit_id: string;
  gate_id: string;
  state: string;
  evidence: GateEvidence;
  evidence_hash: string;
  document_repository_id: string;
  record_path: string;
  document_write_id: string;
  write_status: string;
  pr_url: string | null;
  record_commit: string | null;
}

export interface GateReconciliationDependencies {
  pool: import("pg").Pool;
  verification: GateEffectiveDependencies;
  /** Must use authenticated provider PR facts; branch ancestry alone never supplies this proof. */
  mergedRecord(publication: GatePublicationCandidate): Promise<
    { status: "merged"; location: GitLocation } | { status: "open" | "closed" | "unavailable" }
  >;
}

export type GateReconciliationResult = {
  status: "pending-publication" | "awaiting-merge" | "effective" | "stale" | "failed" | "rejected" | "missing";
  code?: string;
  transitionKey?: string;
};

/** The T15 handoff is the durable gate.effective event, keyed by the immutable decision and evidence. */
export async function reconcileGatePublication(deps: GateReconciliationDependencies, decisionId: string): Promise<GateReconciliationResult> {
  const found = await deps.pool.query<GatePublicationCandidate>(
    `select p.*, d.status as write_status, coalesce(p.pr_url, d.pr_url) as pr_url
       from workflow.gate_publication p join workflow.document_write d on d.id = p.document_write_id
      where p.decision_id = $1`, [decisionId],
  );
  const publication = found.rows[0];
  if (publication === undefined) return { status: "missing" };
  if (publication.state === "effective" || publication.state === "stale" || publication.state === "failed" || publication.state === "rejected") {
    return { status: publication.state };
  }
  if (publication.pr_url === null || publication.write_status === "queued" || publication.write_status === "failed") {
    return { status: "pending-publication" };
  }
  const merged = await deps.mergedRecord(publication);
  if (merged.status === "unavailable") return { status: "awaiting-merge", code: "GATE_PROVIDER_UNAVAILABLE" };
  let result: GateReconciliationResult;
  let recordCommit: string | null = null;
  if (merged.status === "closed") result = { status: "failed", code: "GATE_RECORD_CLOSED" };
  else if (merged.status === "open") result = { status: "awaiting-merge" };
  else if (merged.status === "merged") {
    const { location } = merged;
    const stored = validateGateEvidence(publication.evidence);
    const text = await deps.verification.readRecord(location);
    if (text === undefined) return { status: "awaiting-merge", code: "GATE_RECORD_UNAVAILABLE" };
    const parsed = parseGateRecord(text);
    const record = parsed.status === "valid" ? parsed.evidence : undefined;
    if (!stored.ok || record === undefined || location.repo !== publication.document_repository_id ||
      location.path !== publication.record_path || stored.value.decisionId !== publication.decision_id ||
      stored.value.projectId !== publication.project_id || stored.value.unitId !== publication.unit_id ||
      stored.value.gateId !== publication.gate_id || record.auditEventId !== stored.value.auditEventId ||
      gateEvidenceCanonicalJson(record) !== gateEvidenceCanonicalJson(stored.value) ||
      createHash("sha256").update(gateEvidenceCanonicalJson(record)).digest("hex") !== publication.evidence_hash) {
      result = { status: "failed", code: "GATE_PUBLICATION_MISMATCH" };
    } else {
      const verified = await verifyEffectiveGate({ ...deps.verification, readRecord: async () => text }, location);
      if (verified.status === "effective" || verified.status === "rejected") {
        result = { status: verified.status };
        recordCommit = location.commit;
      } else if (verified.status === "awaiting-evidence") result = { status: "awaiting-merge", code: verified.code };
      else result = { status: verified.status === "invalid" ? "failed" : "stale", code: verified.code };
    }
  }
  else return { status: "awaiting-merge" };
  const tx = await deps.pool.connect();
  try {
    await tx.query("begin");
    const locked = await tx.query<{ state: string }>("select state from workflow.gate_publication where decision_id=$1 for update", [decisionId]);
    const state = locked.rows[0]?.state;
    if (state === "effective" || state === "stale" || state === "failed" || state === "rejected") {
      await tx.query("commit");
      return { status: state };
    }
    const apply = async () => {
      await tx.query("update workflow.gate_publication set state=$2, record_commit=$3, pr_url=$4, updated_at=now() where decision_id=$1", [decisionId, result.status, recordCommit, publication.pr_url]);
    };
    if (result.status === "effective" || result.status === "rejected") {
      const transitionKey = `gate-${result.status}:${decisionId}:${publication.evidence_hash}`;
      await recordTransition(tx, {
        transitionKey, projectId: publication.project_id, unitId: publication.unit_id,
        event: { kind: `gate.${result.status}`, metadata: { decisionId, gateId: publication.gate_id, evidenceHash: publication.evidence_hash, recordCommit: recordCommit! } },
      }, apply);
      result = { ...result, transitionKey };
    } else await apply();
    await tx.query("commit");
    return result;
  } catch (error) {
    await tx.query("rollback");
    throw error;
  } finally { tx.release(); }
}
