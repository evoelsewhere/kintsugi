import {
  DELIVERABLE_ID_PATTERN,
  IDENTIFIER_PATTERN,
  MAX_REQUIRED_DELIVERABLES,
  PROJECT_ID_PATTERN,
} from "./validation.js";
import { isFullUnitId } from "./member-task.js";

const START_MARKER = "<!-- kintsugi:task-association\n";
const END_MARKER = "\n-->";
const MAX_BODY_LENGTH = 100_000;
const MAX_CLAIM_LENGTH = 8_192;

export interface MemberAssociationClaim {
  projectId: string;
  unitId: string;
  contextRevision: string;
  deliverableIds: string[];
}

export type MemberAssociationClaimParseResult =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "valid"; claim: MemberAssociationClaim };

export interface MemberAssociationClaimValidationInput {
  claim: MemberAssociationClaim;
  projectId: string;
  unitId: string;
  repositoryId: string;
  baseRef: string;
  defaultBranch: string | null;
  contextRevision: string;
  requiredDeliverableIds: readonly string[];
  deliverables: readonly { id: string; repositoryId: string }[];
}

export type MemberAssociationClaimValidationResult =
  | { valid: true }
  | { valid: false; reason: "project-mismatch" | "task-mismatch" | "context-mismatch" | "target-branch-mismatch" | "deliverables-mismatch" };

export interface MemberAssociationContext {
  contextRevision: string;
  requiredDeliverableIds: string[];
  deliverables: Array<{ id: string; repositoryId: string }>;
}

/**
 * Reads the bounded, machine-readable association hint from a PR body. The body is
 * untrusted input: this parser only extracts identifiers and never grants authority.
 */
export function parseMemberAssociationClaim(body: unknown): MemberAssociationClaimParseResult {
  if (body === undefined || body === null || body === "") return { status: "absent" };
  if (typeof body !== "string" || body.length > MAX_BODY_LENGTH) return { status: "invalid" };

  const first = body.indexOf(START_MARKER);
  if (first < 0) {
    return body.includes("<!-- kintsugi:task-association") ? { status: "invalid" } : { status: "absent" };
  }
  if (body.indexOf(START_MARKER, first + START_MARKER.length) >= 0) return { status: "invalid" };

  const payloadStart = first + START_MARKER.length;
  const payloadEnd = body.indexOf(END_MARKER, payloadStart);
  if (payloadEnd < payloadStart || payloadEnd - payloadStart > MAX_CLAIM_LENGTH) return { status: "invalid" };
  const payload = body.slice(payloadStart, payloadEnd);
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return { status: "invalid" };
  }

  const claim = validateMemberAssociationClaim(value);
  return claim === undefined ? { status: "invalid" } : { status: "valid", claim };
}

/** Validates the persisted structured claim again at every trust boundary. */
export function validateMemberAssociationClaim(value: unknown): MemberAssociationClaim | undefined {
  return validateClaim(value);
}

/** Extracts only the immutable deliverable contract needed to bind a PR to a snapshot. */
export function readMemberAssociationContext(value: unknown): MemberAssociationContext | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input["contextRevision"] !== "string" || !/^sha256:[a-f0-9]{64}$/.test(input["contextRevision"])) return undefined;
  const manifest = input["manifest"];
  const task = input["task"];
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest) ||
      typeof task !== "object" || task === null || Array.isArray(task)) return undefined;
  const required = (manifest as Record<string, unknown>)["requiredDeliverableIds"];
  const rawDeliverables = (task as Record<string, unknown>)["requiredDeliverables"];
  if (!Array.isArray(required) || required.length > MAX_REQUIRED_DELIVERABLES ||
      !required.every((id) => typeof id === "string" && DELIVERABLE_ID_PATTERN.test(id)) ||
      new Set(required).size !== required.length || !Array.isArray(rawDeliverables) ||
      rawDeliverables.length > MAX_REQUIRED_DELIVERABLES) return undefined;

  const deliverables: Array<{ id: string; repositoryId: string }> = [];
  for (const raw of rawDeliverables) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const item = raw as Record<string, unknown>;
    if (typeof item["id"] !== "string" || !DELIVERABLE_ID_PATTERN.test(item["id"]) ||
        typeof item["repositoryId"] !== "string" || !IDENTIFIER_PATTERN.test(item["repositoryId"])) return undefined;
    deliverables.push({ id: item["id"], repositoryId: item["repositoryId"] });
  }
  if (new Set(deliverables.map(({ id }) => id)).size !== deliverables.length) return undefined;
  return { contextRevision: input["contextRevision"], requiredDeliverableIds: [...required] as string[], deliverables };
}

/** Applies the same conservative repository/task/context checks in API and worker paths. */
export function validateMemberAssociationClaimForTask(
  input: MemberAssociationClaimValidationInput,
): MemberAssociationClaimValidationResult {
  if (input.claim.projectId !== input.projectId) return { valid: false, reason: "project-mismatch" };
  if (input.claim.unitId !== input.unitId) return { valid: false, reason: "task-mismatch" };
  if (input.claim.contextRevision !== input.contextRevision) return { valid: false, reason: "context-mismatch" };
  if (input.defaultBranch === null || input.baseRef !== input.defaultBranch) return { valid: false, reason: "target-branch-mismatch" };
  if (input.claim.deliverableIds.length === 0 || new Set(input.claim.deliverableIds).size !== input.claim.deliverableIds.length) {
    return { valid: false, reason: "deliverables-mismatch" };
  }
  const required = new Set(input.requiredDeliverableIds);
  const declared = new Map(input.deliverables.map(({ id, repositoryId }) => [id, repositoryId]));
  if (declared.size !== input.deliverables.length || input.claim.deliverableIds.some((id) =>
    !required.has(id) || declared.get(id) !== input.repositoryId)) {
    return { valid: false, reason: "deliverables-mismatch" };
  }
  return { valid: true };
}

function validateClaim(value: unknown): MemberAssociationClaim | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (keys.join(",") !== "contextRevision,deliverableIds,projectId,unitId") return undefined;

  const { projectId, unitId, contextRevision, deliverableIds } = input;
  if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId)) return undefined;
  if (typeof unitId !== "string" || unitId.length > 200 || !isFullUnitId(unitId)) return undefined;
  if (typeof contextRevision !== "string" || !/^sha256:[a-f0-9]{64}$/.test(contextRevision)) return undefined;
  if (!Array.isArray(deliverableIds) || deliverableIds.length < 1 || deliverableIds.length > MAX_REQUIRED_DELIVERABLES) return undefined;
  if (!deliverableIds.every((id) => typeof id === "string" && DELIVERABLE_ID_PATTERN.test(id))) return undefined;
  if (new Set(deliverableIds).size !== deliverableIds.length) return undefined;

  return { projectId, unitId, contextRevision, deliverableIds: [...deliverableIds] as string[] };
}
