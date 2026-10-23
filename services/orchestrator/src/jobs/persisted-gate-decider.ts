import type { Pool, PoolClient } from "pg";
import type { GateDecider, GateDecision, GateRequest } from "./model.js";

/** A pool or transaction client; callers own transactions and connection lifetimes. */
export type StageDecisionDb = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export interface StageDecisionRecord {
  runId: string;
  stage: string;
  gate: string;
  decisionMode: GateRequest["decisionMode"];
  options: string[];
  choice?: string;
  actorId?: string;
  decidedAt?: string;
}

export interface StageDecisionSubmission {
  runId: string;
  stage: string;
  gate: string;
  choice: string;
  /** Authenticated application user id supplied by the session-authorized API. */
  actorId: string;
}

export class StageDecisionConflict extends Error {
  readonly code = "STAGE_DECISION_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "StageDecisionConflict";
  }
}

export class StageDecisionNotFound extends Error {
  readonly code = "STAGE_DECISION_NOT_FOUND";

  constructor() {
    super("No open required-human stage decision exists for this run, stage and gate");
    this.name = "StageDecisionNotFound";
  }
}

interface StageDecisionRow {
  job_run_id: string;
  stage_id: string;
  gate_id: string;
  decision_mode: GateRequest["decisionMode"];
  allowed_options: unknown;
  selected_choice: string | null;
  decided_by: string | null;
  decided_at: Date | string | null;
}

const identity = (input: Pick<GateRequest, "runId" | "stage" | "gate">): [string, string, string] => [input.runId, input.stage, input.gate];

function optionsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((option) => typeof option !== "string")) {
    throw new StageDecisionConflict("Persisted stage decision has invalid allowed options");
  }
  return value as string[];
}

function toRecord(row: StageDecisionRow): StageDecisionRecord {
  const decidedAt = row.decided_at instanceof Date ? row.decided_at.toISOString() : row.decided_at;
  return {
    runId: row.job_run_id,
    stage: row.stage_id,
    gate: row.gate_id,
    decisionMode: row.decision_mode,
    options: optionsOf(row.allowed_options),
    ...(row.selected_choice === null ? {} : { choice: row.selected_choice }),
    ...(row.decided_by === null ? {} : { actorId: row.decided_by }),
    ...(decidedAt === null ? {} : { decidedAt }),
  };
}

function validateRequest(request: GateRequest): void {
  const { runId, stage, gate, options, default: fallback } = request;
  if ([runId, stage, gate].some((value) => value.trim() === "")) throw new StageDecisionConflict("Stage decision identity must not be empty");
  if (options.length === 0 || options.length > 64 || options.some((option) => option.trim() === "" || option.length > 200)) {
    throw new StageDecisionConflict("Stage decision must define between 1 and 64 non-empty allowed options");
  }
  if (new Set(options).size !== options.length) throw new StageDecisionConflict("Stage decision allowed options must be unique");
  if (!options.includes(fallback)) throw new StageDecisionConflict("Stage decision default must be one of its allowed options");
}

async function readRow(db: StageDecisionDb, input: Pick<GateRequest, "runId" | "stage" | "gate">): Promise<StageDecisionRow | undefined> {
  const result = await db.query<StageDecisionRow>(
    `select job_run_id, stage_id, gate_id, decision_mode, allowed_options, selected_choice, decided_by, decided_at
       from workflow.stage_decision where job_run_id = $1 and stage_id = $2 and gate_id = $3`,
    identity(input),
  );
  return result.rows[0];
}

/** Read an immutable stage decision, including its original authenticated actor when present. */
export async function readStageDecision(
  db: StageDecisionDb,
  input: Pick<GateRequest, "runId" | "stage" | "gate">,
): Promise<StageDecisionRecord | undefined> {
  const row = await readRow(db, input);
  return row === undefined ? undefined : toRecord(row);
}

/**
 * Submit a human choice to an existing required-human row. Exact replay is idempotent; a second
 * choice or a different actor cannot replace the first authenticated decision.
 */
export async function recordStageDecision(db: StageDecisionDb, input: StageDecisionSubmission): Promise<StageDecisionRecord> {
  if (input.choice.trim() === "" || input.actorId.trim() === "") throw new StageDecisionConflict("Choice and authenticated actor are required");
  const updated = await db.query<StageDecisionRow>(
    `update workflow.stage_decision
        set selected_choice = $4, decided_by = $5, decided_at = clock_timestamp()
      where job_run_id = $1 and stage_id = $2 and gate_id = $3
        and decision_mode = 'required-human' and selected_choice is null
        and allowed_options ? $4
      returning job_run_id, stage_id, gate_id, decision_mode, allowed_options, selected_choice, decided_by, decided_at`,
    [...identity(input), input.choice, input.actorId],
  );
  const row = updated.rows[0];
  if (row !== undefined) return toRecord(row);

  const existing = await readRow(db, input);
  if (existing === undefined) throw new StageDecisionNotFound();
  const record = toRecord(existing);
  if (!record.options.includes(input.choice)) throw new StageDecisionConflict("Choice is not an allowed option for this stage decision");
  if (record.decisionMode !== "required-human") throw new StageDecisionConflict("Only required-human stage decisions accept a submitted choice");
  if (record.choice === input.choice && record.actorId === input.actorId) return record;
  throw new StageDecisionConflict("A conflicting stage decision has already been recorded");
}

export interface PersistedGateDeciderDeps {
  db: StageDecisionDb;
  /** Polling interval while a required human decision is pending. Defaults to five seconds. */
  pollIntervalMs?: number;
}

/** Durable worker-side implementation of the existing procedural gate port. */
export function createPersistedGateDecider(deps: PersistedGateDeciderDeps): GateDecider {
  const interval = deps.pollIntervalMs ?? 5_000;
  if (!Number.isSafeInteger(interval) || interval < 1) throw new RangeError("pollIntervalMs must be a positive integer");

  return {
    async decide(request: GateRequest, signal?: AbortSignal): Promise<GateDecision> {
      validateRequest(request);
      const runId = request.resumeOf ?? request.runId;
      const key = { runId, stage: request.stage, gate: request.gate };
      const initialChoice = request.decisionMode === "default" ? request.default : null;
      await deps.db.query(
        `insert into workflow.stage_decision (job_run_id, stage_id, gate_id, decision_mode, allowed_options, selected_choice, decided_at)
         values ($1, $2, $3, $4, $5::jsonb, $6::text, case when $6::text is null then null else clock_timestamp() end)
         on conflict (job_run_id, stage_id, gate_id) do nothing`,
        [runId, request.stage, request.gate, request.decisionMode, JSON.stringify(request.options), initialChoice],
      );

      for (;;) {
        signal?.throwIfAborted();
        const saved = await readStageDecision(deps.db, key);
        if (saved === undefined) throw new StageDecisionNotFound();
        if (saved.decisionMode !== request.decisionMode || saved.options.length !== request.options.length || saved.options.some((option, index) => option !== request.options[index])) {
          throw new StageDecisionConflict("Stage gate definition changed after its decision was first requested");
        }
        if (saved.choice !== undefined) {
          if (!request.options.includes(saved.choice)) throw new StageDecisionConflict("Persisted choice is no longer an allowed option");
          if (request.decisionMode === "required-human") {
            if (saved.actorId === undefined) throw new StageDecisionConflict("Required-human decision is missing its authenticated actor");
            return { choice: saved.choice, defaulted: false, by: saved.actorId };
          }
          if (saved.choice !== request.default || saved.actorId !== undefined) throw new StageDecisionConflict("Persisted optional decision does not match its documented default");
          return { choice: saved.choice, defaulted: true };
        }
        if (request.decisionMode !== "required-human") throw new StageDecisionConflict("Optional default decision was not durably recorded");
        await wait(interval, signal);
      }
    },
  };
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Stage decision wait aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) onAbort();
  });
}
