import { GATE_KEY_PATTERN, type GateId } from "./index.js";
import { isSafeRepositoryPath, DomainValidationReader, type ValidationResult } from "./validation.js";
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
  decision: "approved" | "rejected" | "waived";
  decisionReason?: string;
  auditEventId: string;
  policyRevision: string;
  contextRevision: string;
  requiredDeliverableIds: string[];
  actor: {
    userId: string;
    authorizationId: string;
  };
  deliverables: GateDeliverableEvidence[];
  waiver?: {
    deliverableIds: string[];
    reason: string;
  };
}

export interface GateDeliverableEvidence {
  /** Approved artifact path, retained when the task moves to another deliverable set. */
  path?: string;
  deliverableId: string;
  repositoryId: string;
  pullRequestId: string;
  reviewResultId: string;
  reviewedRevision: string;
  mergedRevision: string;
}

/** Stable audit binding; the database-generated audit ID is intentionally excluded. */
export function gateEvidenceCanonicalJson(evidence: GateEvidence): string {
  const { auditEventId: _auditEventId, ...decision } = evidence;
  return canonicalJson(decision);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((entry) => canonicalJson(entry)).join(",") + "]";
  const object = value as Record<string, unknown>;
  const entries = Object.keys(object).filter((key) => object[key] !== undefined).sort();
  return "{" + entries.map((key) => JSON.stringify(key) + ":" + canonicalJson(object[key])).join(",") + "}";
}

export function validateGateEvidence(value: unknown): ValidationResult<GateEvidence> {
  const reader = new DomainValidationReader();
  const root = reader.object(value, "", [
    "schemaVersion", "decisionId", "projectId", "unitId", "gateId", "decision", "auditEventId",
    "policyRevision", "contextRevision", "requiredDeliverableIds", "actor", "deliverables", "waiver", "decisionReason",
  ]);
  if (root === undefined) return reader.result({} as GateEvidence);

  const schemaVersion = reader.oneOf(root["schemaVersion"], "schemaVersion", ["1"] as const);
  const decisionId = reader.string(root["decisionId"], "decisionId", { pattern: EVIDENCE_ID_PATTERN });
  const projectId = reader.string(root["projectId"], "projectId");
  const unitId = reader.string(root["unitId"], "unitId");
  if (unitId !== undefined && !isFullUnitId(unitId)) reader.problem("unitId", "must be a full application/module/unit identity");
  const gateId = reader.string(root["gateId"], "gateId", { pattern: GATE_KEY_PATTERN });
  const decision = reader.oneOf(root["decision"], "decision", ["approved", "rejected", "waived"] as const);
  const decisionReason = reader.optionalString(root["decisionReason"], "decisionReason", { maxLength: 2000 });
  if (decision === "rejected" && decisionReason === undefined) reader.problem("decisionReason", "is required for a rejected decision");
  if (decision !== undefined && decision !== "rejected" && decisionReason !== undefined) reader.problem("decisionReason", "is allowed only for a rejected decision");
  const auditEventId = reader.string(root["auditEventId"], "auditEventId", { pattern: EVIDENCE_ID_PATTERN });
  const policyRevision = reader.string(root["policyRevision"], "policyRevision");
  const contextRevision = reader.string(root["contextRevision"], "contextRevision", { pattern: CONTEXT_REVISION_PATTERN });
  const requiredDeliverableIds = reader.strings(root["requiredDeliverableIds"], "requiredDeliverableIds", { nonEmpty: true, unique: true });

  let waiver: GateEvidence["waiver"];
  if (root["waiver"] !== undefined) {
    const rawWaiver = reader.object(root["waiver"], "waiver", ["deliverableIds", "reason"]);
    if (rawWaiver !== undefined) {
      const deliverableIds = reader.strings(rawWaiver["deliverableIds"], "waiver.deliverableIds", { nonEmpty: true, unique: true, maxLength: 100, itemMaxLength: 100 });
      const reason = reader.string(rawWaiver["reason"], "waiver.reason", { maxLength: 2000 });
      if (deliverableIds !== undefined && reason !== undefined) waiver = { deliverableIds, reason };
    }
  }
  if (decision === "waived" && waiver === undefined) reader.problem("waiver", "is required for a waived decision");
  if (decision !== undefined && decision !== "waived" && waiver !== undefined) reader.problem("waiver", "is allowed only for a waived decision");

  const rawActor = reader.object(root["actor"], "actor", ["userId", "authorizationId"]);
  const userId = rawActor === undefined ? undefined : reader.string(rawActor["userId"], "actor.userId", { pattern: EVIDENCE_ID_PATTERN });
  const authorizationId = rawActor === undefined ? undefined : reader.string(rawActor["authorizationId"], "actor.authorizationId", { pattern: EVIDENCE_ID_PATTERN });

  const rawDeliverables = reader.array(root["deliverables"], "deliverables", { nonEmpty: true, maxLength: 100 });
  const deliverables: GateDeliverableEvidence[] = [];
  rawDeliverables?.forEach((raw, index) => {
    const at = "deliverables[" + index + "]";
    const item = reader.object(raw, at, [
      "deliverableId", "repositoryId", "pullRequestId", "reviewResultId", "reviewedRevision", "mergedRevision", "path",
    ]);
    if (item === undefined) return;
    const deliverableId = reader.string(item["deliverableId"], at + ".deliverableId", { pattern: EVIDENCE_ID_PATTERN });
    const repositoryId = reader.string(item["repositoryId"], at + ".repositoryId", { pattern: EVIDENCE_ID_PATTERN });
    const pullRequestId = reader.string(item["pullRequestId"], at + ".pullRequestId", { pattern: EVIDENCE_ID_PATTERN });
    const reviewResultId = reader.string(item["reviewResultId"], at + ".reviewResultId", { pattern: EVIDENCE_ID_PATTERN });
    const reviewedRevision = reader.string(item["reviewedRevision"], at + ".reviewedRevision", { pattern: COMMIT_ID_PATTERN });
    const mergedRevision = reader.string(item["mergedRevision"], at + ".mergedRevision", { pattern: COMMIT_ID_PATTERN });
    const path = reader.optionalString(item["path"], at + ".path", {maxLength:1000});
    if (path !== undefined && !isSafeRepositoryPath(path)) reader.problem(at + ".path", "must be a safe repository path");
    if (deliverableId !== undefined && repositoryId !== undefined && pullRequestId !== undefined && reviewResultId !== undefined && reviewedRevision !== undefined && mergedRevision !== undefined) {
      deliverables.push({ deliverableId, repositoryId, pullRequestId, reviewResultId, reviewedRevision, mergedRevision, ...(path === undefined ? {} : {path}) });
    }
  });

  if (requiredDeliverableIds !== undefined) {
    const waivedIds = waiver?.deliverableIds ?? [];
    const seen = new Set<string>();
    for (const item of deliverables) {
      if (seen.has(item.deliverableId)) reader.problem("deliverables", "contains duplicate deliverable " + item.deliverableId);
      seen.add(item.deliverableId);
    }
    for (const deliverableId of requiredDeliverableIds) {
      if (waivedIds.includes(deliverableId)) {
        if (seen.has(deliverableId)) reader.problem("waiver.deliverableIds", "cannot waive deliverable " + deliverableId + " that is also recorded as evidence");
      } else if (!seen.has(deliverableId)) {
        reader.problem("deliverables", "is missing required deliverable " + deliverableId);
      }
    }
    for (const item of deliverables) {
      if (!requiredDeliverableIds.includes(item.deliverableId)) {
        reader.problem("deliverables", "contains unrequired deliverable " + item.deliverableId);
      }
    }
    for (const deliverableId of waivedIds) {
      if (!requiredDeliverableIds.includes(deliverableId)) reader.problem("waiver.deliverableIds", "contains unrequired deliverable " + deliverableId);
    }
    if (waivedIds.length === requiredDeliverableIds.length && waivedIds.length > 0) {
      reader.problem("waiver.deliverableIds", "must leave at least one required deliverable verified");
    }
  }

  return reader.result({
    schemaVersion: schemaVersion ?? "1",
    decisionId: decisionId ?? "",
    projectId: projectId ?? "",
    unitId: unitId ?? "",
    gateId: gateId ?? "G4",
    decision: decision ?? "approved",
    ...(decisionReason === undefined ? {} : { decisionReason }),
    auditEventId: auditEventId ?? "",
    policyRevision: policyRevision ?? "",
    contextRevision: contextRevision ?? "",
    requiredDeliverableIds: requiredDeliverableIds ?? [],
    actor: { userId: userId ?? "", authorizationId: authorizationId ?? "" },
    deliverables,
    ...(waiver === undefined ? {} : { waiver }),
  });
}
