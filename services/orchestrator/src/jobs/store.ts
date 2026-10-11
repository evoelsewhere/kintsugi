// Postgres adapter of the job store: workflow.job_run, workflow.artifact and
// governance.restricted_record (migration 010_job_runs.sql), plus the project facts a job
// needs (its legacy and document repositories, the agent's model binding).

import { encryptSecret } from "@kintsugi/secrets";
import type { Pool } from "pg";
import type { DocumentWriteRequest } from "../queues.js";
import type { WorkspaceState, WorkspaceStates } from "./cleanup.js";
import type { ArtifactEntry, JobEventRecord, JobKind, JobRun, JobStatus, JobStore, ModelBinding, NewJobRun, StepLimits } from "./model.js";

interface RunRow {
  id: string;
  project_id: string;
  application_id: string | null;
  parent_id: string | null;
  kind: JobKind;
  name: string;
  status: JobStatus;
  failure_reason: string | null;
  source_repository_id: string | null;
  source_commit: string | null;
  inputs: Record<string, unknown>;
  limits: Partial<StepLimits>;
  script_hash: string | null;
  agent: string | null;
  actor: string | null;
  output_summary: Record<string, unknown> | null;
  document_write_id: string | null;
}

const MAX_REASON = 2000;

const optional = <K extends string, V>(key: K, value: V | null): { [P in K]?: V } => (value === null ? {} : ({ [key]: value } as { [P in K]?: V }));

function toRun(row: RunRow): JobRun {
  return {
    id: row.id,
    projectId: row.project_id,
    ...optional("applicationId", row.application_id),
    ...optional("parentId", row.parent_id),
    kind: row.kind,
    name: row.name,
    status: row.status,
    ...optional("failureReason", row.failure_reason),
    ...optional("sourceRepositoryId", row.source_repository_id),
    ...optional("sourceCommit", row.source_commit),
    inputs: row.inputs,
    limits: row.limits,
    ...optional("scriptHash", row.script_hash),
    ...optional("agent", row.agent),
    ...optional("actor", row.actor),
    ...optional("outputSummary", row.output_summary),
    ...optional("documentWriteId", row.document_write_id),
  };
}

export class PgJobStore implements JobStore, WorkspaceStates {
  constructor(private readonly pool: Pool) {}

  async get(id: string): Promise<JobRun | undefined> {
    const result = await this.pool.query<RunRow>("select * from workflow.job_run where id = $1", [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : toRun(row);
  }

  async create(run: NewJobRun): Promise<void> {
    await this.pool.query(
      `insert into workflow.job_run (id, project_id, application_id, parent_id, kind, name, source_repository_id, source_commit, inputs, limits, actor)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        run.id,
        run.projectId,
        run.applicationId ?? null,
        run.parentId ?? null,
        run.kind,
        run.name,
        run.sourceRepositoryId ?? null,
        run.sourceCommit ?? null,
        JSON.stringify(run.inputs ?? {}),
        JSON.stringify(run.limits ?? {}),
        run.actor ?? null,
      ],
    );
  }

  async start(id: string): Promise<boolean> {
    const result = await this.pool.query("update workflow.job_run set status = 'running', started_at = now() where id = $1 and status = 'queued'", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async update(id: string, patch: { sourceCommit?: string; scriptHash?: string; agent?: string }): Promise<void> {
    await this.pool.query(
      `update workflow.job_run
          set source_commit = coalesce($2, source_commit), script_hash = coalesce($3, script_hash), agent = coalesce($4, agent)
        where id = $1`,
      [id, patch.sourceCommit ?? null, patch.scriptHash ?? null, patch.agent ?? null],
    );
  }

  async succeed(id: string, summary: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      "update workflow.job_run set status = 'succeeded', failure_reason = null, output_summary = $2, finished_at = now() where id = $1",
      [id, JSON.stringify(summary)],
    );
  }

  async fail(id: string, reason: string, summary?: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      "update workflow.job_run set status = 'failed', failure_reason = $2, output_summary = coalesce($3, output_summary), finished_at = now() where id = $1",
      [id, reason.slice(0, MAX_REASON), summary === undefined ? null : JSON.stringify(summary)],
    );
  }

  async cancel(id: string): Promise<void> {
    await this.pool.query("update workflow.job_run set status = 'cancelled', finished_at = now() where id = $1 and status in ('queued', 'running')", [id]);
  }

  async cancelRequested(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const result = await this.pool.query<{ id: string }>("select id from workflow.job_run where id = any($1) and cancel_requested_at is not null", [ids]);
    return result.rows.map((row) => row.id);
  }

  async addEvent(event: JobEventRecord): Promise<void> {
    await this.pool
      .query("insert into workflow.job_event (job_run_id, step_run_id, kind, message, data) values ($1, $2, $3, $4, $5)", [
        event.runId,
        event.stepId ?? null,
        event.kind,
        event.message.slice(0, MAX_REASON),
        JSON.stringify(event.data ?? {}),
      ])
      .catch(() => undefined);
  }

  async addArtifacts(id: string, entries: readonly ArtifactEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.pool.query(
        `insert into workflow.artifact (job_run_id, path, sha256, size, provenance) values ($1, $2, $3, $4, $5)
         on conflict (job_run_id, path) do update set sha256 = $3, size = $4, provenance = $5`,
        [id, entry.path, entry.sha256, entry.size, JSON.stringify(entry.provenance)],
      );
    }
  }

  async addRestricted(id: string, path: string, content: Buffer): Promise<void> {
    // Restricted files are text (masked inventories); binary content is kept as base64.
    const text = content.toString("utf8");
    const plaintext = Buffer.from(text, "utf8").equals(content) ? text : `base64:${content.toString("base64")}`;
    const encrypted = encryptSecret(plaintext);
    await this.pool.query(
      `insert into governance.restricted_record (job_run_id, path, ciphertext, iv, auth_tag, size) values ($1, $2, $3, $4, $5, $6)
       on conflict (job_run_id, path) do update set ciphertext = $3, iv = $4, auth_tag = $5, size = $6`,
      [id, path, encrypted.ciphertext, encrypted.iv, encrypted.authTag, content.byteLength],
    );
  }

  async recordDocumentWrite(id: string, request: DocumentWriteRequest): Promise<void> {
    await this.pool.query(
      `insert into workflow.document_write (id, project_id, kind, message, actor, job_id, agent) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do nothing`,
      [request.writeId, request.projectId, request.kind, request.message, request.actor ?? null, request.jobId ?? null, request.agent ?? null],
    );
    await this.pool.query("update workflow.job_run set document_write_id = $2 where id = $1", [id, request.writeId]);
  }

  async workspaceStates(ids: readonly string[]): Promise<Map<string, WorkspaceState>> {
    const result = await this.pool.query<{ id: string; status: string; finished_at: Date | null; write_status: string | null }>(
      `select r.id, r.status, r.finished_at, w.status as write_status
         from workflow.job_run r left join workflow.document_write w on w.id = r.document_write_id
        where r.id = any($1)`,
      [ids],
    );
    return new Map(
      result.rows.map((row) => [
        row.id,
        { status: row.status, ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }), ...(row.write_status === null ? {} : { writeStatus: row.write_status }) },
      ]),
    );
  }

  async legacyRepository(projectId: string, applicationId: string): Promise<string | undefined> {
    const result = await this.pool.query<{ repository_id: string }>(
      `select repository_id from admin.project_repository
        where project_id = $1 and application_id = $2 and role = 'legacy'
        order by created_at, repository_id limit 1`,
      [projectId, applicationId],
    );
    return result.rows[0]?.repository_id;
  }

  async documentRepository(projectId: string): Promise<string | undefined> {
    const result = await this.pool.query<{ repository_id: string }>(
      "select repository_id from admin.project_repository where project_id = $1 and role = 'document'",
      [projectId],
    );
    return result.rows[0]?.repository_id;
  }

  async modelBinding(agent: string, projectId: string): Promise<ModelBinding | undefined> {
    const result = await this.pool.query<{ provider_id: string; model: string; thinking: string | null }>(
      `select provider_id, model, thinking from admin.agent_model_binding
        where agent = $1 and project_id in ($2, '*')
        order by (project_id = '*') limit 1`,
      [agent, projectId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { provider: row.provider_id, model: row.model, ...(row.thinking === null ? {} : { thinking: row.thinking }) };
  }
}
