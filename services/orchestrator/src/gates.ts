// Gates for the worker (migration 013: governance.gate). A stage plan that reaches a gate
// requests it here — idempotently: while the same gate (project, application, key, subject) is
// pending, asking again returns the open request — and later polls its decision, which a person
// takes in the portal (approve, reject or waive). Database only: no HTTP, no queue.

import type { GateStatus } from "@kintsugi/domain";
import type { Pool, PoolClient } from "pg";

/** Anything that runs queries: the pool, or a client inside a transaction. */
export type GateDb = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/** Who requests gates on behalf of the worker, unless a request names a person. */
export const WORKER_ACTOR = "kintsugi-worker";

/** The audit action of a gate request (the API's catalog: AUDIT_ACTIONS.gateRequest). */
const GATE_REQUEST_ACTION = "gate.request";

export interface GateRequest {
  /** The gate row id to use when a new gate is created. */
  id: string;
  projectId: string;
  applicationId?: string;
  /** `G0`–`G6` or a stage gate key such as `stage:assess`. */
  gateKey: string;
  title: string;
  /** What the gate is about, e.g. the job run that reached it. */
  subject?: string;
  /** Small context for the decider; never content or credentials. */
  detail?: Record<string, unknown>;
  /** Defaults to WORKER_ACTOR. */
  requestedBy?: string;
}

export interface GateState {
  id: string;
  status: GateStatus;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

interface StateRow {
  id: string;
  status: GateStatus;
  decided_by: string | null;
  decided_at: Date | null;
  note: string | null;
}

const toState = (row: StateRow): GateState => ({
  id: row.id,
  status: row.status,
  ...(row.decided_by === null ? {} : { decidedBy: row.decided_by }),
  ...(row.decided_at === null ? {} : { decidedAt: row.decided_at.toISOString() }),
  ...(row.note === null ? {} : { note: row.note }),
});

/**
 * Opens a pending gate, or returns the one already pending for the same project, application,
 * key and subject (`created: false`). A new request is audited in the same statement.
 */
export async function requestGate(db: GateDb, request: GateRequest): Promise<GateState & { created: boolean }> {
  const inserted = await db.query<StateRow>(
    `with created as (
       insert into governance.gate (id, project_id, application_id, gate_key, title, subject, detail, requested_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (project_id, coalesce(application_id, ''), gate_key, coalesce(subject, '')) where status = 'pending' do nothing
       returning id, status, decided_by, decided_at, note, project_id, application_id, gate_key, subject, requested_by
     ), audited as (
       insert into governance.audit_event (actor, action, project_id, subject, detail)
       select requested_by, $9, project_id, id, jsonb_strip_nulls(jsonb_build_object('gateKey', gate_key, 'applicationId', application_id, 'about', subject))
         from created
     )
     select id, status, decided_by, decided_at, note from created`,
    [
      request.id,
      request.projectId,
      request.applicationId ?? null,
      request.gateKey,
      request.title,
      request.subject ?? null,
      JSON.stringify(request.detail ?? {}),
      request.requestedBy ?? WORKER_ACTOR,
      GATE_REQUEST_ACTION,
    ],
  );
  const row = inserted.rows[0];
  if (row !== undefined) return { ...toState(row), created: true };
  const pending = await db.query<StateRow>(
    `select id, status, decided_by, decided_at, note from governance.gate
      where status = 'pending' and project_id = $1 and coalesce(application_id, '') = $2 and gate_key = $3 and coalesce(subject, '') = $4`,
    [request.projectId, request.applicationId ?? "", request.gateKey, request.subject ?? ""],
  );
  const existing = pending.rows[0];
  // Decided between the two statements: ask again for a fresh gate.
  if (existing === undefined) return requestGate(db, request);
  return { ...toState(existing), created: false };
}

/** The gate's current state; undefined when it does not exist (e.g. its project was deleted). */
export async function gateState(db: GateDb, id: string): Promise<GateState | undefined> {
  const result = await db.query<StateRow>("select id, status, decided_by, decided_at, note from governance.gate where id = $1", [id]);
  const row = result.rows[0];
  return row === undefined ? undefined : toState(row);
}

export interface WaitOptions {
  /** Milliseconds between polls (default 5000). */
  intervalMs?: number;
  signal?: AbortSignal;
}

/**
 * Polls until the gate is decided and returns its final state. Throws when the gate disappears
 * and rejects with the signal's reason when it aborts.
 */
export async function waitForGate(db: GateDb, id: string, options: WaitOptions = {}): Promise<GateState> {
  const interval = options.intervalMs ?? 5000;
  for (;;) {
    options.signal?.throwIfAborted();
    const state = await gateState(db, id);
    if (state === undefined) throw new Error(`Gate ${id} no longer exists`);
    if (state.status !== "pending") return state;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        options.signal?.removeEventListener("abort", onAbort);
        resolve();
      }, interval);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(options.signal?.reason);
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
