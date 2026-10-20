import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { canonicalJson, validateText, type JsonObject, type JsonValue, type OutboxOperation, type TransitionInput, type TransitionReceipt } from "./model.js";

const MAX_INTENTS = 32;

interface EventRow {
  id: string;
  sequence: string;
}

interface OperationRow {
  operation_id: string;
  transition_key: string;
  project_id: string;
  queue: string;
  intent_key: string;
  payload: JsonValue;
  attempts: number;
}

function operationIdFor(transitionKey: string, intentKey: string): string {
  return createHash("sha256").update("kintsugi.member-outbox.v1\0").update(transitionKey).update("\0").update(intentKey).digest("hex");
}

function toOperation(row: OperationRow): OutboxOperation {
  return {
    operationId: row.operation_id,
    transitionKey: row.transition_key,
    projectId: row.project_id,
    queue: row.queue,
    intentKey: row.intent_key,
    payload: row.payload,
    attempts: row.attempts,
  };
}

function canonicalObject(value: unknown, label: string): JsonObject {
  const normalized = canonicalJson(value, label);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
    throw new TypeError(label + " must be a JSON object");
  }
  return normalized;
}

function normalizeInput(input: TransitionInput): {
  transitionKey: string;
  projectId: string;
  unitId: string | null;
  event: { kind: string; metadata: JsonObject } | null;
  intents: Array<{ intentKey: string; queue: string; payload: JsonValue }>;
  inputHash: string;
} {
  const transitionKey = validateText(input.transitionKey, "transitionKey", 200);
  const projectId = validateText(input.projectId, "projectId", 200);
  const unitId = input.unitId === undefined ? null : validateText(input.unitId, "unitId", 500);
  const event = input.event === undefined
    ? null
    : {
        kind: validateText(input.event.kind, "event.kind", 100),
        metadata: canonicalObject(input.event.metadata ?? {}, "event.metadata"),
      };
  const sourceIntents = input.queueIntents ?? [];
  if (sourceIntents.length > MAX_INTENTS) throw new RangeError("queueIntents cannot exceed " + MAX_INTENTS + " entries");
  const intents = sourceIntents.map((intent) => ({
    intentKey: validateText(intent.intentKey, "queue intent key", 200),
    queue: validateText(intent.queue, "queue", 100),
    payload: canonicalJson(intent.payload, "queue intent payload"),
  }));
  const keys = new Set<string>();
  for (const intent of intents) {
    if (keys.has(intent.intentKey)) throw new RangeError("duplicate queue intent key: " + intent.intentKey);
    keys.add(intent.intentKey);
  }
  intents.sort((left, right) => left.intentKey.localeCompare(right.intentKey));

  const fingerprint = canonicalJson({ projectId, unitId, event, intents }, "transition input");
  const inputHash = createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex");
  return { transitionKey, projectId, unitId, event, intents, inputHash };
}

/**
 * Persists one state transition, its event and follow-up intents in the caller's transaction.
 * apply must only write the same database; never call Git, a provider or a queue here.
 */
export async function recordTransition(
  tx: PoolClient,
  change: TransitionInput,
  apply: (tx: PoolClient) => Promise<void>,
): Promise<TransitionReceipt> {
  const input = normalizeInput(change);
  const inserted = await tx.query<{ transition_key: string }>(
    "insert into workflow.member_transition (transition_key, project_id, unit_id, input_hash) values ($1, $2, $3, $4) on conflict (transition_key) do nothing returning transition_key",
    [input.transitionKey, input.projectId, input.unitId, input.inputHash],
  );

  if (inserted.rows.length === 0) {
    const existing = await tx.query<{ input_hash: string }>(
      "select input_hash from workflow.member_transition where transition_key = $1",
      [input.transitionKey],
    );
    const prior = existing.rows[0];
    if (prior === undefined) throw new Error("transition disappeared during idempotency check");
    if (prior.input_hash !== input.inputHash) throw new IdempotencyConflictError(input.transitionKey);

    const eventResult = await tx.query<EventRow>(
      "select id, sequence::text as sequence from workflow.member_event where transition_key = $1",
      [input.transitionKey],
    );
    const eventRow = eventResult.rows[0];
    const operations = await readTransitionOperations(tx, input.transitionKey);
    return {
      created: false,
      transitionKey: input.transitionKey,
      ...(eventRow === undefined ? {} : { event: { eventId: eventRow.id, sequence: eventRow.sequence } }),
      operations,
    };
  }

  await apply(tx);

  let event: TransitionReceipt["event"];
  if (input.event !== null) {
    const cursor = await tx.query<{ last_sequence: string }>(
      "insert into workflow.member_event_cursor (project_id, last_sequence) values ($1, 1) on conflict (project_id) do update set last_sequence = workflow.member_event_cursor.last_sequence + 1 returning last_sequence::text as last_sequence",
      [input.projectId],
    );
    const sequence = cursor.rows[0]?.last_sequence;
    if (sequence === undefined) throw new Error("failed to allocate project event sequence");
    const eventId = randomUUID();
    await tx.query(
      "insert into workflow.member_event (id, project_id, sequence, transition_key, unit_id, kind, metadata) values ($1, $2, $3, $4, $5, $6, $7)",
      [eventId, input.projectId, sequence, input.transitionKey, input.unitId, input.event.kind, JSON.stringify(input.event.metadata)],
    );
    event = { eventId, sequence };
  }

  const operations: OutboxOperation[] = [];
  for (const intent of input.intents) {
    const operationId = operationIdFor(input.transitionKey, intent.intentKey);
    const insertedOperation = await tx.query<OperationRow>(
      "insert into workflow.outbox (operation_id, transition_key, project_id, queue, intent_key, payload) values ($1, $2, $3, $4, $5, $6) returning operation_id, transition_key, project_id, queue, intent_key, payload, attempts",
      [operationId, input.transitionKey, input.projectId, intent.queue, intent.intentKey, JSON.stringify(intent.payload)],
    );
    const row = insertedOperation.rows[0];
    if (row === undefined) throw new Error("failed to persist queue intent");
    operations.push(toOperation(row));
  }

  return {
    created: true,
    transitionKey: input.transitionKey,
    ...(event === undefined ? {} : { event }),
    operations,
  };
}

async function readTransitionOperations(db: Pick<Pool, "query"> | Pick<PoolClient, "query">, transitionKey: string): Promise<OutboxOperation[]> {
  const result = await db.query<OperationRow>(
    "select operation_id, transition_key, project_id, queue, intent_key, payload, attempts from workflow.outbox where transition_key = $1 order by intent_key",
    [transitionKey],
  );
  return result.rows.map(toOperation);
}

export class IdempotencyConflictError extends Error {
  constructor(transitionKey: string) {
    super("transition key was reused with different input: " + transitionKey);
    this.name = "IdempotencyConflictError";
  }
}

export class OutboxLeaseLostError extends Error {
  constructor(operationId: string) {
    super("outbox lease is no longer owned for operation " + operationId);
    this.name = "OutboxLeaseLostError";
  }
}

export class PostgresOutboxStore {
  constructor(private readonly pool: Pool) {}

  async claim(workerId: string, limit: number, leaseMs: number): Promise<OutboxOperation[]> {
    validateText(workerId, "workerId", 200);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError("limit must be an integer from 1 to 500");
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 3_600_000) throw new RangeError("leaseMs must be from 1 to 3600000");
    const result = await this.pool.query<OperationRow>(
      "with candidates as (" +
        " select operation_id from workflow.outbox" +
        " where (status = 'pending' and next_attempt_at <= now())" +
        " or (status = 'leased' and lease_until <= now())" +
        " order by created_at, operation_id for update skip locked limit $2" +
        ") update workflow.outbox as outbox" +
        " set status = 'leased', lease_owner = $1," +
        " lease_until = now() + ($3::double precision * interval '1 millisecond')," +
        " attempts = attempts + 1, updated_at = now()" +
        " from candidates where outbox.operation_id = candidates.operation_id" +
        " returning outbox.operation_id, outbox.transition_key, outbox.project_id, outbox.queue," +
        " outbox.intent_key, outbox.payload, outbox.attempts",
      [workerId, limit, leaseMs],
    );
    return result.rows.map(toOperation);
  }

  async acknowledge(operationId: string, workerId: string): Promise<void> {
    const result = await this.pool.query(
      "update workflow.outbox set status = 'published', lease_owner = null, lease_until = null," +
        " published_at = now(), last_error_code = null, updated_at = now()" +
        " where operation_id = $1 and status = 'leased' and lease_owner = $2",
      [operationId, workerId],
    );
    if ((result.rowCount ?? 0) !== 1) throw new OutboxLeaseLostError(operationId);
  }

  async retry(operationId: string, workerId: string, delayMs: number, errorCode: string): Promise<void> {
    validateText(errorCode, "errorCode", 100);
    if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(errorCode)) throw new TypeError("errorCode must be an uppercase code");
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 86_400_000) throw new RangeError("delayMs must be from 0 to 86400000");
    const result = await this.pool.query(
      "update workflow.outbox set status = 'pending', lease_owner = null, lease_until = null," +
        " next_attempt_at = now() + ($3::double precision * interval '1 millisecond')," +
        " last_error_code = $4, updated_at = now()" +
        " where operation_id = $1 and status = 'leased' and lease_owner = $2",
      [operationId, workerId, delayMs, errorCode],
    );
    if ((result.rowCount ?? 0) !== 1) throw new OutboxLeaseLostError(operationId);
  }
}

/** Stable across duplicate deliveries so a downstream queue can deduplicate safely. */
export function stableOperationId(transitionKey: string, intentKey: string): string {
  return operationIdFor(transitionKey, intentKey);
}
