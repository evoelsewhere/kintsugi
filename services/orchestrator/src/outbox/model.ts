import type { Pool, PoolClient } from "pg";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface TransitionEventInput {
  kind: string;
  metadata?: JsonObject;
}

export interface QueueIntentInput {
  /** Stable within one transition; also participates in the derived operation ID. */
  intentKey: string;
  queue: string;
  payload: JsonValue;
}

export interface TransitionInput {
  /** Caller-owned idempotency key, stable across retries. */
  transitionKey: string;
  projectId: string;
  unitId?: string;
  event?: TransitionEventInput;
  queueIntents?: readonly QueueIntentInput[];
}

export interface OutboxOperation {
  operationId: string;
  transitionKey: string;
  projectId: string;
  queue: string;
  intentKey: string;
  payload: JsonValue;
  /** Number of publish attempts, including the current claim. */
  attempts: number;
}

export interface TransitionReceipt {
  created: boolean;
  transitionKey: string;
  event?: { eventId: string; sequence: string };
  operations: OutboxOperation[];
}

export interface OutboxStore {
  claim(workerId: string, limit: number, leaseMs: number): Promise<OutboxOperation[]>;
  acknowledge(operationId: string, workerId: string): Promise<void>;
  retry(operationId: string, workerId: string, delayMs: number, errorCode: string): Promise<void>;
}

/** Convert unknown input to bounded, canonical JSON before persistence or hashing. */
export function canonicalJson(value: unknown, label: string): JsonValue {
  const seen = new WeakSet<object>();
  const visit = (item: unknown): JsonValue => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError(label + " must contain only finite numbers");
      return item;
    }
    if (typeof item !== "object") throw new TypeError(label + " must contain only JSON values");
    if (seen.has(item)) throw new TypeError(label + " must not contain circular values");
    seen.add(item);
    try {
      if (Array.isArray(item)) return item.map(visit);
      const prototype = Object.getPrototypeOf(item) as object | null;
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError(label + " must contain plain objects");
      const output: JsonObject = Object.create(null) as JsonObject;
      for (const key of Object.keys(item).sort()) {
        const child = (item as Record<string, unknown>)[key];
        if (child === undefined) throw new TypeError(label + " must not contain undefined values");
        output[key] = visit(child);
      }
      return output;
    } finally {
      seen.delete(item);
    }
  };

  const normalized = visit(value);
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > 65_536) {
    throw new RangeError(label + " exceeds the 65536-byte limit");
  }
  return normalized;
}

export function validateText(value: string, label: string, maxLength: number): string {
  if (value.trim().length === 0 || value.length > maxLength) {
    throw new RangeError(label + " must contain 1 to " + maxLength + " characters");
  }
  return value;
}

/** Transaction-aware query surface for callers that already opened a transaction. */
export type TransitionDb = Pick<PoolClient, "query">;
export type OutboxQueryDb = Pick<Pool, "query"> | Pick<PoolClient, "query">;
