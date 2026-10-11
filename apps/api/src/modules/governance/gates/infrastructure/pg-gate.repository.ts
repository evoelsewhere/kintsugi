// Postgres adapter of gates (migration 013: governance.gate). The partial unique index
// `gate_one_pending` keeps one pending gate per project, application, key and subject; a
// decision only moves a row that is still pending.

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool } from "#common/db/pool.js";
import type { Gate, GateFilter, GateStatus, NewGate } from "../domain/gate.js";
import { GateRepository } from "../domain/gate.repository.js";

interface Row {
  id: string;
  project_id: string;
  application_id: string | null;
  gate_key: string;
  title: string;
  status: GateStatus;
  subject: string | null;
  detail: Record<string, unknown>;
  requested_by: string;
  requested_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  note: string | null;
}

const COLUMNS = "id, project_id, application_id, gate_key, title, status, subject, detail, requested_by, requested_at, decided_by, decided_at, note";

const optional = <K extends string, V>(key: K, value: V | null): { [P in K]?: V } => (value === null ? {} : ({ [key]: value } as { [P in K]?: V }));

const toGate = (row: Row): Gate => ({
  id: row.id,
  projectId: row.project_id,
  ...optional("applicationId", row.application_id),
  gateKey: row.gate_key,
  title: row.title,
  status: row.status,
  ...optional("subject", row.subject),
  detail: row.detail,
  requestedBy: row.requested_by,
  requestedAt: row.requested_at.toISOString(),
  ...optional("decidedBy", row.decided_by),
  ...optional("decidedAt", row.decided_at?.toISOString() ?? null),
  ...optional("note", row.note),
});

@Injectable()
export class PgGateRepository extends GateRepository {
  get #pool(): Pool {
    return getPool();
  }

  async list(filter: GateFilter, limit: number, offset: number): Promise<{ items: Gate[]; total: number }> {
    const where =
      "($1::text is null or project_id = $1) and ($2::text is null or application_id = $2) and ($3::text is null or gate_key = $3) and ($4::text[] is null or status = any($4))";
    const params = [filter.projectId ?? null, filter.applicationId ?? null, filter.gateKey ?? null, filter.statuses === undefined || filter.statuses.length === 0 ? null : filter.statuses];
    const [rows, count] = await Promise.all([
      this.#pool.query<Row>(`select ${COLUMNS} from governance.gate where ${where} order by requested_at desc, id limit $5 offset $6`, [...params, limit, offset]),
      this.#pool.query<{ total: number }>(`select count(*)::int as total from governance.gate where ${where}`, params),
    ]);
    return { items: rows.rows.map(toGate), total: count.rows[0]?.total ?? 0 };
  }

  async get(id: string): Promise<Gate | undefined> {
    const result = await this.#pool.query<Row>(`select ${COLUMNS} from governance.gate where id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : toGate(row);
  }

  async findPending(gate: Pick<NewGate, "projectId" | "applicationId" | "gateKey" | "subject">): Promise<Gate | undefined> {
    const result = await this.#pool.query<Row>(
      `select ${COLUMNS} from governance.gate
        where status = 'pending' and project_id = $1 and coalesce(application_id, '') = $2 and gate_key = $3 and coalesce(subject, '') = $4`,
      [gate.projectId, gate.applicationId ?? "", gate.gateKey, gate.subject ?? ""],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toGate(row);
  }

  async create(gate: NewGate): Promise<Gate | undefined> {
    const result = await this.#pool.query<Row>(
      `insert into governance.gate (id, project_id, application_id, gate_key, title, subject, detail, requested_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (project_id, coalesce(application_id, ''), gate_key, coalesce(subject, '')) where status = 'pending' do nothing
       returning ${COLUMNS}`,
      [gate.id, gate.projectId, gate.applicationId ?? null, gate.gateKey, gate.title, gate.subject ?? null, JSON.stringify(gate.detail ?? {}), gate.requestedBy],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toGate(row);
  }

  async decide(id: string, status: Exclude<GateStatus, "pending">, decidedBy: string, note: string | undefined): Promise<Gate | undefined> {
    const result = await this.#pool.query<Row>(
      `update governance.gate set status = $2, decided_by = $3, decided_at = now(), note = $4
        where id = $1 and status = 'pending' returning ${COLUMNS}`,
      [id, status, decidedBy, note ?? null],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toGate(row);
  }

  async history(gate: Pick<Gate, "projectId" | "applicationId" | "gateKey">, limit: number): Promise<Gate[]> {
    const result = await this.#pool.query<Row>(
      `select ${COLUMNS} from governance.gate
        where project_id = $1 and coalesce(application_id, '') = $2 and gate_key = $3
        order by requested_at desc, id limit $4`,
      [gate.projectId, gate.applicationId ?? "", gate.gateKey, limit],
    );
    return result.rows.map(toGate);
  }
}
