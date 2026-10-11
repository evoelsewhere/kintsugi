// Postgres adapter for document writes (ADR-0010; schema: workflow, migration
// 009_document_writes.sql). The API creates rows as `queued`; the worker's writer fills in
// the outcome columns.

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool } from "#common/db/pool.js";
import type { DocumentWriteFilter, DocumentWriteRecord, DocumentWriteStatus, NewDocumentWrite } from "../domain/document-write.js";
import { DocumentWriteStore } from "../domain/document-write.ports.js";

interface WriteRow {
  id: string;
  project_id: string;
  kind: string;
  status: DocumentWriteStatus;
  message: string;
  branch: string | null;
  commit_sha: string | null;
  branch_commit_sha: string | null;
  pr_url: string | null;
  error: string | null;
  actor: string | null;
  job_id: string | null;
  agent: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = "id, project_id, kind, status, message, branch, commit_sha, branch_commit_sha, pr_url, error, actor, job_id, agent, created_at, updated_at";

const optional = <K extends string>(key: K, value: string | null): { [P in K]?: string } => (value === null ? {} : ({ [key]: value } as { [P in K]?: string }));

function toRecord(row: WriteRow): DocumentWriteRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    status: row.status,
    message: row.message,
    ...optional("commit", row.commit_sha),
    ...optional("branch", row.branch),
    ...optional("branchCommit", row.branch_commit_sha),
    ...optional("prUrl", row.pr_url),
    ...optional("error", row.error),
    ...optional("actor", row.actor),
    ...optional("jobId", row.job_id),
    ...optional("agent", row.agent),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class PgDocumentWriteStore extends DocumentWriteStore {
  get #pool(): Pool {
    return getPool();
  }

  async create(write: NewDocumentWrite): Promise<DocumentWriteRecord> {
    const result = await this.#pool.query<WriteRow>(
      `insert into workflow.document_write (id, project_id, kind, message, actor) values ($1, $2, $3, $4, $5) returning ${COLUMNS}`,
      [write.id, write.projectId, write.kind, write.message, write.actor ?? null],
    );
    return toRecord(result.rows[0]!);
  }

  async listForProject(projectId: string, limit: number, offset: number): Promise<{ items: DocumentWriteRecord[]; total: number }> {
    const [rows, count] = await Promise.all([
      this.#pool.query<WriteRow>(`select ${COLUMNS} from workflow.document_write where project_id = $1 order by created_at desc, id limit $2 offset $3`, [
        projectId,
        limit,
        offset,
      ]),
      this.#pool.query<{ total: number }>("select count(*)::int as total from workflow.document_write where project_id = $1", [projectId]),
    ]);
    return { items: rows.rows.map(toRecord), total: count.rows[0]?.total ?? 0 };
  }

  async list(filter: DocumentWriteFilter, limit: number, offset: number): Promise<{ items: DocumentWriteRecord[]; total: number }> {
    const where = "($1::text[] is null or status = any($1)) and ($2::text is null or project_id = $2)";
    const params = [filter.statuses === undefined || filter.statuses.length === 0 ? null : [...filter.statuses], filter.projectId ?? null];
    const [rows, count] = await Promise.all([
      this.#pool.query<WriteRow>(`select ${COLUMNS} from workflow.document_write where ${where} order by created_at desc, id limit $3 offset $4`, [...params, limit, offset]),
      this.#pool.query<{ total: number }>(`select count(*)::int as total from workflow.document_write where ${where}`, params),
    ]);
    return { items: rows.rows.map(toRecord), total: count.rows[0]?.total ?? 0 };
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.#pool.query("update workflow.document_write set status = 'failed', error = $2, updated_at = now() where id = $1", [id, error.slice(0, 2000)]);
  }
}
