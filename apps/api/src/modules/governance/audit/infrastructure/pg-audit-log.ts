// Postgres adapter of the audit log (migration 011: governance.audit_event, append-only).

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool, withTransaction } from "#common/db/pool.js";
import type { AuditEntry, AuditQuery, NewAuditEntry } from "../domain/audit-entry.js";
import { AuditLog } from "../domain/audit-log.port.js";

interface Row {
  id: string;
  at: Date;
  actor: string;
  action: string;
  project_id: string | null;
  subject: string | null;
  detail: Record<string, unknown>;
}

const toEntry = (row: Row): AuditEntry => ({
  id: row.id,
  at: row.at.toISOString(),
  actor: row.actor,
  action: row.action,
  ...(row.project_id === null ? {} : { projectId: row.project_id }),
  ...(row.subject === null ? {} : { subject: row.subject }),
  detail: row.detail,
});

@Injectable()
export class PgAuditLog extends AuditLog {
  get #pool(): Pool {
    return getPool();
  }

  async append(entries: readonly NewAuditEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await withTransaction(async (client) => {
      for (const entry of entries) {
        await client.query("insert into governance.audit_event (actor, action, project_id, subject, detail) values ($1, $2, $3, $4, $5)", [
          entry.actor,
          entry.action,
          entry.projectId ?? null,
          entry.subject ?? null,
          JSON.stringify(entry.detail ?? {}),
        ]);
      }
    });
  }

  async list(query: AuditQuery): Promise<{ items: AuditEntry[]; total: number }> {
    const filter = "($1::text is null or action = $1) and ($2::text is null or subject = $2) and ($3::text is null or project_id = $3)";
    const params = [query.action ?? null, query.subject ?? null, query.projectId ?? null];
    const [rows, count] = await Promise.all([
      this.#pool.query<Row>(`select id::text, at, actor, action, project_id, subject, detail from governance.audit_event where ${filter} order by at desc, id desc limit $4 offset $5`, [
        ...params,
        query.limit,
        query.offset,
      ]),
      this.#pool.query<{ total: number }>(`select count(*)::int as total from governance.audit_event where ${filter}`, params),
    ]);
    return { items: rows.rows.map(toEntry), total: count.rows[0]?.total ?? 0 };
  }

  async get(id: string): Promise<AuditEntry | undefined> {
    if (!/^\d{1,18}$/.test(id)) return undefined;
    const result = await this.#pool.query<Row>("select id::text, at, actor, action, project_id, subject, detail from governance.audit_event where id = $1", [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : toEntry(row);
  }
}
