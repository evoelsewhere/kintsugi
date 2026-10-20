// Durable workflow transitions, ordered project events and at-least-once outbox delivery.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { dispatchOutbox } from "../src/outbox/dispatch.js";
import { IdempotencyConflictError, PostgresOutboxStore, recordTransition } from "../src/outbox/store.js";
import type { TransitionInput } from "../src/outbox/model.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

async function inTransaction<T>(db: TestDatabase, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function transition(transitionKey = randomUUID()): TransitionInput {
  return {
    transitionKey,
    projectId: "outbox-project",
    unitId: "billing/invoices/tax",
    event: { kind: "task.updated", metadata: { status: "ready" } },
    queueIntents: [{ intentKey: "continue", queue: "workflow-next-step", payload: { reason: "gate-effective" } }],
  };
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

describe.skipIf(!hasDatabase)("durable workflow outbox (integration)", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.pool.query("insert into admin.project (id, name) values ('outbox-project', 'Outbox project')");
    await db.pool.query("create table public.test_transition_projection (transition_key text primary key, writes integer not null)");
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("EVT-01 rolls back the projection, transition, event and queue intent together", async () => {
    const input = transition();
    await expect(
      inTransaction(db, async (client) => {
        await recordTransition(client, input, async (tx) => {
          await tx.query("insert into public.test_transition_projection (transition_key, writes) values ($1, 1)", [input.transitionKey]);
        });
        throw new Error("simulate caller failure before commit");
      }),
    ).rejects.toThrow("simulate caller failure");

    const counts = await db.pool.query<{ transitions: number; events: number; operations: number; projections: number }>(
      `select
         (select count(*)::int from workflow.member_transition where transition_key = $1) as transitions,
         (select count(*)::int from workflow.member_event where transition_key = $1) as events,
         (select count(*)::int from workflow.outbox where transition_key = $1) as operations,
         (select count(*)::int from public.test_transition_projection where transition_key = $1) as projections`,
      [input.transitionKey],
    );
    expect(counts.rows[0]).toEqual({ transitions: 0, events: 0, operations: 0, projections: 0 });
  });

  it("OUTBOX-IDEMPOTENCY-01 applies a concurrent duplicate transition once and allocates one continuation", async () => {
    const input = transition();
    let applies = 0;
    let firstApplyEntered!: () => void;
    let releaseFirst!: () => void;
    const entered = new Promise<void>((resolve) => (firstApplyEntered = resolve));
    const blocked = new Promise<void>((resolve) => (releaseFirst = resolve));
    const apply = async (tx: PoolClient) => {
      applies += 1;
      await tx.query("insert into public.test_transition_projection (transition_key, writes) values ($1, $2) on conflict (transition_key) do update set writes = public.test_transition_projection.writes + 1", [
        input.transitionKey,
        1,
      ]);
      if (applies === 1) {
        firstApplyEntered();
        await blocked;
      }
    };

    const first = inTransaction(db, (client) => recordTransition(client, input, apply));
    await entered;
    const second = inTransaction(db, (client) => recordTransition(client, input, apply));
    await delay(25);
    releaseFirst();
    const receipts = await Promise.all([first, second]);

    expect(applies).toBe(1);
    expect(receipts.map((receipt) => receipt.created).sort()).toEqual([false, true]);
    expect(receipts[0]?.operations).toHaveLength(1);
    expect(receipts[1]?.operations).toHaveLength(1);
    const rows = await db.pool.query<{ writes: number; events: number; operations: number }>(
      `select p.writes,
              (select count(*)::int from workflow.member_event where transition_key = $1) as events,
              (select count(*)::int from workflow.outbox where transition_key = $1) as operations
       from public.test_transition_projection p where p.transition_key = $1`,
      [input.transitionKey],
    );
    expect(rows.rows[0]).toEqual({ writes: 1, events: 1, operations: 1 });
    await expect(
      inTransaction(db, (client) => recordTransition(
        client,
        { ...input, event: { kind: "task.updated", metadata: { status: "changed" } } },
        async () => { applies += 1; },
      )),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(applies).toBe(1);
    await db.pool.query(
      "update workflow.outbox set status = 'published', published_at = now() where transition_key = $1",
      [input.transitionKey],
    );
  });

  it("EVT-02 holds project event order until the earlier transaction commits", async () => {
    const firstInput = transition();
    const secondInput = transition();
    const firstClient = await db.pool.connect();
    let secondApplyEntered!: () => void;
    const secondStarted = new Promise<void>((resolve) => (secondApplyEntered = resolve));
    let secondFinished = false;
    try {
      await firstClient.query("begin");
      const firstReceipt = await recordTransition(firstClient, firstInput, async (tx) => {
        await tx.query("insert into public.test_transition_projection (transition_key, writes) values ($1, 1)", [firstInput.transitionKey]);
      });
      const firstSequence = firstReceipt.event?.sequence ?? "";
      const secondPromise = inTransaction(db, async (client) => {
        const receipt = await recordTransition(client, secondInput, async (tx) => {
          secondApplyEntered();
          await tx.query("insert into public.test_transition_projection (transition_key, writes) values ($1, 1)", [secondInput.transitionKey]);
        });
        secondFinished = true;
        return receipt;
      });
      await secondStarted;
      await delay(25);
      expect(secondFinished).toBe(false);
      await firstClient.query("commit");
      const secondReceipt = await secondPromise;
      expect(BigInt(secondReceipt.event?.sequence ?? "0")).toBe(BigInt(firstSequence) + 1n);
    } finally {
      await firstClient.query("rollback").catch(() => undefined);
      firstClient.release();
    }
    await db.pool.query(
      "update workflow.outbox set status = 'published', published_at = now() where transition_key in ($1, $2)",
      [firstInput.transitionKey, secondInput.transitionKey],
    );
  });

  it("EVT-03 replays a stable operation ID after publish succeeds but acknowledgment fails", async () => {
    const input = transition();
    await inTransaction(db, (client) => recordTransition(client, input, async (tx) => {
      await tx.query("insert into public.test_transition_projection (transition_key, writes) values ($1, 1)", [input.transitionKey]);
    }));

    const store = new PostgresOutboxStore(db.pool);
    let failAck = true;
    const interruptedStore = {
      claim: store.claim.bind(store),
      retry: store.retry.bind(store),
      acknowledge: async (operationId: string, workerId: string) => {
        if (failAck) {
          failAck = false;
          throw new Error("simulated crash after publish");
        }
        return store.acknowledge(operationId, workerId);
      },
    };
    const attempts: string[] = [];
    const accepted = new Set<string>();
    let effectiveOperations = 0;
    const publish = async (operation: { operationId: string }) => {
      attempts.push(operation.operationId);
      if (!accepted.has(operation.operationId)) {
        accepted.add(operation.operationId);
        effectiveOperations += 1;
      }
    };
    const abort = new AbortController();
    await expect(
      dispatchOutbox({ store: interruptedStore, publish, workerId: "worker-a", leaseMs: 40 }, abort.signal),
    ).rejects.toThrow("simulated crash after publish");

    await delay(80);
    const summary = await dispatchOutbox({ store, publish, workerId: "worker-b", leaseMs: 40 }, abort.signal);
    expect(summary).toMatchObject({ claimed: 1, published: 1, retried: 0 });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toBe(attempts[1]);
    expect(effectiveOperations).toBe(1);

    const state = await db.pool.query<{ status: string; attempts: number }>(
      "select status, attempts from workflow.outbox where transition_key = $1",
      [input.transitionKey],
    );
    expect(state.rows).toEqual([{ status: "published", attempts: 2 }]);
  });

  it("OUTBOX-RETRY-01 retries publish failures with a redacted code and stable operation ID", async () => {
    const input = transition();
    await inTransaction(db, (client) => recordTransition(client, input, async (tx) => {
      await tx.query("insert into public.test_transition_projection (transition_key, writes) values ($1, 1)", [input.transitionKey]);
    }));

    const store = new PostgresOutboxStore(db.pool);
    let fail = true;
    const operationIds: string[] = [];
    const publish = async (operation: { operationId: string }) => {
      operationIds.push(operation.operationId);
      if (fail) {
        fail = false;
        throw new Error("provider failure with private response content");
      }
    };
    const abort = new AbortController();
    const first = await dispatchOutbox(
      { store, publish, workerId: "worker-c", retryBaseMs: 0, retryMaxMs: 0 },
      abort.signal,
    );
    expect(first).toMatchObject({ claimed: 1, published: 0, retried: 1 });

    const queued = await db.pool.query<{ status: string; attempts: number; last_error_code: string | null }>(
      "select status, attempts, last_error_code from workflow.outbox where transition_key = $1",
      [input.transitionKey],
    );
    expect(queued.rows).toEqual([{ status: "pending", attempts: 1, last_error_code: "PUBLISH_FAILED" }]);

    const second = await dispatchOutbox(
      { store, publish, workerId: "worker-c", retryBaseMs: 0, retryMaxMs: 0 },
      abort.signal,
    );
    expect(second).toMatchObject({ claimed: 1, published: 1, retried: 0 });
    expect(operationIds).toHaveLength(2);
    expect(operationIds[0]).toBe(operationIds[1]);
  });
});
