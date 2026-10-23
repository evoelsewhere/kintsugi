import type { OutboxOperation, OutboxStore } from "./model.js";

export interface DispatchDependencies {
  store: OutboxStore;
  publish(operation: OutboxOperation, signal: AbortSignal): Promise<void>;
  workerId: string;
  batchSize?: number;
  leaseMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface DispatchSummary {
  claimed: number;
  published: number;
  retried: number;
}

/**
 * Publishes one claimed batch. Delivery is at least once; publishers must deduplicate by
 * operationId because publication can succeed immediately before a worker crashes.
 */
export async function dispatchOutbox(deps: DispatchDependencies, signal: AbortSignal): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, published: 0, retried: 0 };
  if (signal.aborted) return summary;

  const batchSize = deps.batchSize ?? 25;
  const leaseMs = deps.leaseMs ?? 30_000;
  const retryBaseMs = deps.retryBaseMs ?? 1_000;
  const retryMaxMs = deps.retryMaxMs ?? 300_000;
  if (deps.workerId.trim().length === 0 || deps.workerId.length > 200) throw new RangeError("workerId must contain 1 to 200 characters");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new RangeError("batchSize must be an integer from 1 to 500");
  if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 3_600_000) throw new RangeError("leaseMs must be from 1 to 3600000");
  if (!Number.isInteger(retryBaseMs) || retryBaseMs < 0) throw new RangeError("retryBaseMs must be a nonnegative integer");
  if (!Number.isInteger(retryMaxMs) || retryMaxMs < retryBaseMs || retryMaxMs > 86_400_000) throw new RangeError("retryMaxMs must be between retryBaseMs and 86400000");
  const batch = await deps.store.claim(deps.workerId, batchSize, leaseMs);
  summary.claimed = batch.length;

  for (const operation of batch) {
    if (signal.aborted) break;
    try {
      await deps.publish(operation, signal);
    } catch {
      // Do not persist provider messages that might contain secrets or user data.
      if (signal.aborted) break;
      const exponent = Math.min(Math.max(operation.attempts - 1, 0), 30);
      const delayMs = Math.min(retryMaxMs, retryBaseMs * 2 ** exponent);
      await deps.store.retry(operation.operationId, deps.workerId, delayMs, "PUBLISH_FAILED");
      summary.retried += 1;
      continue;
    }
    // If this fails, let the lease expire. Replaying the same operationId is safe.
    await deps.store.acknowledge(operation.operationId, deps.workerId);
    summary.published += 1;
  }
  return summary;
}
