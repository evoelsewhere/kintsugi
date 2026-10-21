import type { GateEvidence, GatePublicationState } from "@kintsugi/domain";
export type { GatePublicationState } from "@kintsugi/domain";
import type { AuditRecord } from "#common/audit/audit-trail.js";

export interface GatePublication {
  decisionId: string;
  projectId: string;
  unitId: string;
  gateId: string;
  decision: GateEvidence["decision"];
  state: GatePublicationState;
  evidenceHash: string;
  recordPath: string;
  documentWriteId: string;
  documentWriteStatus: string;
  createdAt: string;
  updatedAt: string;
  prUrl?: string;
  recordCommit?: string;
}

export interface AwaitingGateEvidence {
  state: "awaiting-evidence";
  projectId: string;
  unitId: string;
  gateId: string;
  missingDeliverableIds: string[];
  blockers: string[];
}

export type GateDecisionResult = GatePublication | AwaitingGateEvidence;

export interface CreateGatePublication {
  evidence: Omit<GateEvidence, "auditEventId">;
  evidenceHash: string;
  audit: AuditRecord;
  documentRepositoryId: string;
  recordPath: string;
  message: string;
  actorLabel: string;
}

export interface RequestGateDecision {
  projectId: string;
  unitId: string;
  gateId: string;
  decision: GateEvidence["decision"];
  decisionReason?: string;
  waiverDeliverableIds?: string[];
  waiverReason?: string;
}
