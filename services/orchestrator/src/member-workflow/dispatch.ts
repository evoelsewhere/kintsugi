import type { OutboxOperation, TransitionReceipt } from "../outbox/model.js";
import { CONTINUATION_QUEUE, type EffectiveGateFacts } from "./continue.js";
import { applyContinuation, type ContinuationDependencies } from "./project.js";

/** Only the immutable gate identity crosses the outbox boundary; plans come from current Git. */
export async function dispatchContinuation(deps: ContinuationDependencies, operation: OutboxOperation): Promise<TransitionReceipt> {
  const payload = operation.payload;
  if (operation.queue !== CONTINUATION_QUEUE || payload === null || Array.isArray(payload) || typeof payload !== "object") throw new TypeError("invalid continuation operation");
  const fields = ["projectId", "unitId", "gateId", "decisionId", "evidenceHash", "recordCommit"] as const;
  for (const field of fields) if (typeof payload[field] !== "string" || payload[field].length === 0 || payload[field].length > 500) throw new TypeError("invalid continuation identity");
  const input = payload as unknown as EffectiveGateFacts;
  if (input.projectId !== operation.projectId || operation.transitionKey !== `gate-effective:${input.decisionId}:${input.evidenceHash}` || operation.intentKey !== "continue-effective-gate" || !/^[a-f0-9]{64}$/.test(input.evidenceHash) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.recordCommit)) throw new TypeError("continuation identity mismatch");
  return applyContinuation(deps, input);
}
