import { GATE_KEY_PATTERN, type GateId } from "./index.js";
import { DomainValidationReader, type ValidationResult } from "./validation.js";
import { isFullUnitId } from "./member-task.js";

const COMMIT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const CONTEXT_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const EVIDENCE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;

/** Immutable, authority-linked evidence for a human gate decision. */
export interface GateEvidence {
  schemaVersion: "1";
  decisionId: string;
  projectId: string;
  unitId: string;
  gateId: GateId | (string & {});
  decision: "approved" | "rejected";
  auditEventId: string;
  policyRevision: string;
  contextRevision: string;
  requiredDeliverableIds: string[];
  actor: {
    userId: string;
    authorizationId: string;
  };
  deliverables: GateDeliverableEvidence[];
}

export interface GateDeliverableEvidence {
  deliverableId: string;
  repositoryId: string;
  pullRequestId: string;
  reviewResultId: string;
  reviewedRevision: string;
  mergedRevision: string;
}

export function validateGateEvidence(value: unknown): ValidationResult<GateEvidence> {
  const reader = new DomainValidationReader();
  const root = reader.object(value, "", [
    "schemaVersion", "decisionId", "projectId", "unitId", "gateId", "decision", "auditEventId",
    "policyRevision", "contextRevision", "requiredDeliverableIds", "actor", "deliverables",
  ]);
  if (root === undefined) return reader.result({} as GateEvidence);

  const schemaVersion = reader.oneOf(root["schemaVersion"], "schemaVersion", ["1"] as const);
  const decisionId = reader.string(root["decisionId"], "decisionId", { pattern: EVIDENCE_ID_PATTERN });
  const projectId = reader.string(root["projectId"], "projectId");
  const unitId = reader.string(root["unitId"], "unitId");
  if (unitId !== undefined && !isFullUnitId(unitId)) reader.problem("unitId", "must be a full application/module/unit identity");
  const gateId = reader.string(root["gateId"], "gateId", { pattern: GATE_KEY_PATTERN });
  const decision = reader.oneOf(root["decision"], "decision", ["approved", "rejected"] as const);
  const auditEventId = reader.string(root["auditEventId"], "auditEventId", { pattern: EVIDENCE_ID_PATTERN });
  const policyRevision = reader.string(root["policyRevision"], "policyRevision");
  const contextRevision = reader.string(root["contextRevision"], "contextRevision", { pattern: CONTEXT_REVISION_PATTERN });
  const requiredDeliverableIds = reader.strings(root["requiredDeliverableIds"], "requiredDeliverableIds", { nonEmpty: true, unique: true });

  const rawActor = reader.object(root["actor"], "actor", ["userId", "authorizationId"]);
  const userId = rawActor === undefined ? undefined : reader.string(rawActor["userId"], "actor.userId", { pattern: EVIDENCE_ID_PATTERN });
  const authorizationId = rawActor === undefined ? undefined : reader.string(rawActor["authorizationId"], "actor.authorizationId", { pattern: EVIDENCE_ID_PATTERN });

  const rawDeliverables = reader.array(root["deliverables"], "deliverables", { nonEmpty: true, maxLength: 100 });
  const deliverables: GateDeliverableEvidence[] = [];
  rawDeliverables?.forEach((raw, index) => {
    const at = "deliverables[" + index + "]";
    const item = reader.object(raw, at, [
      "deliverableId", "repositoryId", "pullRequestId", "reviewResultId", "reviewedRevision", "mergedRevision",
    ]);
    if (item === undefined) return;
    const deliverableId = reader.string(item["deliverableId"], at + ".deliverableId", { pattern: EVIDENCE_ID_PATTERN });
    const repositoryId = reader.string(item["repositoryId"], at + ".repositoryId", { pattern: EVIDENCE_ID_PATTERN });
    const pullRequestId = reader.string(item["pullRequestId"], at + ".pullRequestId", { pattern: EVIDENCE_ID_PATTERN });
    const reviewResultId = reader.string(item["reviewResultId"], at + ".reviewResultId", { pattern: EVIDENCE_ID_PATTERN });
    const reviewedRevision = reader.string(item["reviewedRevision"], at + ".reviewedRevision", { pattern: COMMIT_ID_PATTERN });
    const mergedRevision = reader.string(item["mergedRevision"], at + ".mergedRevision", { pattern: COMMIT_ID_PATTERN });
    if (deliverableId !== undefined && repositoryId !== undefined && pullRequestId !== undefined && reviewResultId !== undefined && reviewedRevision !== undefined && mergedRevision !== undefined) {
      deliverables.push({ deliverableId, repositoryId, pullRequestId, reviewResultId, reviewedRevision, mergedRevision });
    }
  });

  if (requiredDeliverableIds !== undefined) {
    const seen = new Set<string>();
    for (const item of deliverables) {
      if (seen.has(item.deliverableId)) reader.problem("deliverables", "contains duplicate deliverable " + item.deliverableId);
      seen.add(item.deliverableId);
    }
    for (const deliverableId of requiredDeliverableIds) {
      if (!seen.has(deliverableId)) reader.problem("deliverables", "is missing required deliverable " + deliverableId);
    }
    for (const item of deliverables) {
      if (!requiredDeliverableIds.includes(item.deliverableId)) {
        reader.problem("deliverables", "contains unrequired deliverable " + item.deliverableId);
      }
    }
  }

  return reader.result({
    schemaVersion: schemaVersion ?? "1",
    decisionId: decisionId ?? "",
    projectId: projectId ?? "",
    unitId: unitId ?? "",
    gateId: gateId ?? "G4",
    decision: decision ?? "approved",
    auditEventId: auditEventId ?? "",
    policyRevision: policyRevision ?? "",
    contextRevision: contextRevision ?? "",
    requiredDeliverableIds: requiredDeliverableIds ?? [],
    actor: { userId: userId ?? "", authorizationId: authorizationId ?? "" },
    deliverables,
  });
}
