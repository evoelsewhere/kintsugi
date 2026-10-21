import { parseGateRecord, unitGateReviewPath } from "@kintsugi/domain";
import { DOCUMENT_WRITE_QUEUE, type DocumentWriteRequest } from "../queues.js";
import type { OutboxOperation } from "../outbox/model.js";

export interface GatePublicationPublisher {
  enqueue(documentRepositoryId: string, request: DocumentWriteRequest): Promise<void>;
}

export interface GatePublicationResult {
  status: "queued";
  operationId: string;
}

/** Validates the durable gate intent before handing the same idempotent write to the writer queue. */
export async function publishGate(deps: GatePublicationPublisher, operation: OutboxOperation): Promise<GatePublicationResult> {
  if (operation.queue !== DOCUMENT_WRITE_QUEUE || operation.intentKey !== "publish-gate-record") {
    throw new TypeError("outbox operation is not a gate record publication");
  }
  const payload = asObject(operation.payload, "gate publication payload");
  const documentRepositoryId = nonemptyString(payload["documentRepositoryId"], "documentRepositoryId");
  const requestValue = asObject(payload["request"], "document write request");
  const writeId = nonemptyString(requestValue["writeId"], "writeId");
  const projectId = nonemptyString(requestValue["projectId"], "projectId");
  const kind = nonemptyString(requestValue["kind"], "kind");
  const unit = nonemptyString(requestValue["unit"], "unit");
  const actor = nonemptyString(requestValue["actor"], "actor");
  const message = nonemptyString(requestValue["message"], "message");
  if (writeId !== operation.transitionKey || projectId !== operation.projectId || kind !== "state-change" || requestValue["reviewAll"] !== true) {
    throw new TypeError("gate record write identity or review policy is invalid");
  }
  const files = requestValue["files"];
  if (!Array.isArray(files) || files.length !== 1) throw new TypeError("gate publication must write exactly one evidence record");
  const file = asObject(files[0], "gate record file");
  const path = nonemptyString(file["path"], "gate record path");
  const content = nonemptyString(file["content"], "gate record content");
  if (Buffer.byteLength(content, "utf8") > 65_536) throw new RangeError("gate record exceeds 65536 bytes");
  const parsed = parseGateRecord(content);
  if (parsed.status !== "valid") throw new TypeError("gate record content is invalid: " + parsed.code);
  const evidence = parsed.evidence;
  if (evidence.decisionId !== operation.transitionKey || evidence.projectId !== projectId || evidence.unitId !== unit) {
    throw new TypeError("gate record identity does not match its durable operation");
  }
  const [application, module, unitName] = unit.split("/");
  if (application === undefined || module === undefined || unitName === undefined ||
      path !== unitGateReviewPath(application, module, unitName, evidence.gateId)) {
    throw new TypeError("gate record path does not match its evidence identity");
  }

  const request: DocumentWriteRequest = {
    writeId,
    projectId,
    kind,
    message,
    files: [{ path, content }],
    actor,
    unit,
    reviewAll: true,
  };
  await deps.enqueue(documentRepositoryId, request);
  return { status: "queued", operationId: operation.operationId };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(label + " must be an object");
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(label + " must be a non-empty string");
  return value;
}
