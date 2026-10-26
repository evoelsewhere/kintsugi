// Postgres adapter for runtime job runs (ADR-0010; migration 010_job_runs.sql): reads
// workflow.job_run, workflow.artifact and the linked workflow.document_write, and decrypts
// governance.restricted_record for authorized readers. The API only creates stage runs; the
// worker writes everything else.

import { Injectable } from "@nestjs/common";
import type { SourceRepo } from "@kintsugi/domain";
import { decryptSecret } from "@kintsugi/secrets";
import type { Pool, PoolClient } from "pg";
import { getPool, withTransaction } from "#common/db/pool.js";
import type {
  ArtifactView,
  CancelOutcome,
  JobAttemptView,
  JobRunDetail,
  JobRunEventKind,
  JobRunEventView,
  JobRunFilter,
  JobRunKind,
  JobRunStatus,
  JobRunView,
  NewStageRun,
  RestrictedRecordFilter,
  RestrictedRecordSummary,
  RestrictedRecordView,
} from "../domain/job-run.js";
import { RunScopeConflict } from "../domain/run-scope-conflict.js";
import { JobRunStore } from "../domain/job-run.ports.js";

interface RunRow {
  id: string;
  project_id: string;
  application_id: string | null;
  parent_id: string | null;
  kind: JobRunKind;
  name: string;
  status: JobRunStatus;
  attempt: number;
  attempts: unknown;
  failure_reason: string | null;
  source_repository_id: string | null;
  source_commit: string | null;
  sources: unknown;
  script_hash: string | null;
  agent: string | null;
  actor: string | null;
  output_summary: Record<string, unknown> | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  cancel_requested_at: Date | null;
  scope_items: unknown;
  scope_set: string | null;
  scope_regenerate: string | null;
  scope_draft: string | null;
  abandoned_at: Date | null;
  write_id: string | null;
  write_status: string | null;
  write_branch: string | null;
  write_pr_url: string | null;
  write_error: string | null;
  restricted_records: number;
}

const SELECT = `
  select r.id, r.project_id, r.application_id, r.parent_id, r.kind, r.name, r.status, r.attempt, r.attempts, r.failure_reason,
         r.source_repository_id, r.source_commit, r.sources, r.script_hash, r.agent, r.actor, r.output_summary,
         r.started_at, r.finished_at, r.created_at, r.cancel_requested_at,
         r.inputs->'scope'->'items' as scope_items, r.inputs->'scope'->>'set' as scope_set, r.inputs->'scope'->>'regenerate' as scope_regenerate, r.inputs->'scope'->>'draft' as scope_draft, r.abandoned_at,
         w.id as write_id, w.status as write_status, w.branch as write_branch, w.pr_url as write_pr_url, w.error as write_error,
         (select count(*)::int from governance.restricted_record x where x.job_run_id = r.id) as restricted_records
    from workflow.job_run r
    left join workflow.document_write w on w.id = r.document_write_id`;

/** The sources of a row: the recorded list, else the one repository a run recorded before the list existed. */
function sourcesOf(row: RunRow): SourceRepo[] | undefined {
  if (Array.isArray(row.sources)) {
    const list = row.sources.flatMap((entry: unknown): SourceRepo[] => {
      const { repositoryId, commit, role } = (entry ?? {}) as { repositoryId?: unknown; commit?: unknown; role?: unknown };
      return typeof repositoryId === "string" ? [{ repositoryId, ...(typeof commit === "string" ? { commit } : {}), ...(role === "legacy" || role === "target" ? { role } : {}) }] : [];
    });
    if (list.length > 0) return list;
  }
  return row.source_repository_id === null ? undefined : [{ repositoryId: row.source_repository_id, ...(row.source_commit === null ? {} : { commit: row.source_commit }) }];
}

/** The attempts that ended, as recorded by the worker; entries that are not well formed are left out. */
function attemptsOf(value: unknown): JobAttemptView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown): JobAttemptView[] => {
    const { n, status, startedAt, finishedAt, reason } = (entry ?? {}) as Record<string, unknown>;
    if (typeof n !== "number" || (status !== "succeeded" && status !== "failed" && status !== "cancelled")) return [];
    return [{ n, status, ...(typeof startedAt === "string" ? { startedAt } : {}), ...(typeof finishedAt === "string" ? { finishedAt } : {}), ...(typeof reason === "string" ? { reason } : {}) }];
  });
}

const optional = <K extends string, V>(key: K, value: V | null): { [P in K]?: V } => (value === null ? {} : ({ [key]: value } as { [P in K]?: V }));

function toView(row: RunRow): JobRunView {
  return {
    id: row.id,
    projectId: row.project_id,
    ...optional("applicationId", row.application_id),
    ...optional("parentId", row.parent_id),
    kind: row.kind,
    name: row.name,
    status: row.status,
    attempt: row.attempt,
    ...(row.parent_id === null && attemptsOf(row.attempts).length > 0 ? { attempts: attemptsOf(row.attempts) } : {}),
    ...optional("failureReason", row.failure_reason),
    ...optional("sourceRepositoryId", row.source_repository_id),
    ...optional("sourceCommit", row.source_commit),
    ...optional("sources", sourcesOf(row) ?? null),
    ...optional("scriptHash", row.script_hash),
    ...optional("agent", row.agent),
    ...optional("actor", row.actor),
    ...optional("outputSummary", row.output_summary),
    ...(row.write_id === null
      ? {}
      : {
          documentWrite: {
            id: row.write_id,
            status: row.write_status ?? "queued",
            ...optional("branch", row.write_branch),
            ...optional("prUrl", row.write_pr_url),
            ...optional("error", row.write_error),
          },
        }),
    restrictedRecords: row.restricted_records,
    ...optional("cancelRequestedAt", row.cancel_requested_at?.toISOString() ?? null),
    ...(Array.isArray(row.scope_items) ? { scope: { items: row.scope_items.filter((item): item is string => typeof item === "string"), ...(row.scope_set === null ? {} : { set: row.scope_set }), ...(row.scope_regenerate === "true" ? { regenerate: true } : {}), ...(row.scope_draft === "true" ? { draft: true } : {}) } } : {}),
    ...optional("abandonedAt", row.abandoned_at?.toISOString() ?? null),
    ...optional("startedAt", row.started_at?.toISOString() ?? null),
    ...optional("finishedAt", row.finished_at?.toISOString() ?? null),
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class PgJobRunStore extends JobRunStore {
  get #pool(): Pool {
    return getPool();
  }

  async createStageRun(run: NewStageRun): Promise<JobRunView> {
    return withTransaction(async (tx) => {
      await this.#claimScope(tx, run.projectId, run.applicationId, run.stage, run.inputs ?? {}, run.id);
      await tx.query(
        `insert into workflow.job_run (id, project_id, application_id, kind, name, source_repository_id, actor, source_commit, sources, inputs)
         values ($1, $2, $3, 'stage', $4, $5, $6, $7, $8, $9)`,
        [run.id, run.projectId, run.applicationId, run.stage, run.sources[0]!.repositoryId, run.actor ?? null, run.sources[0]!.commit ?? null, JSON.stringify(run.sources), JSON.stringify(run.inputs ?? {})],
      );
      const result = await tx.query<RunRow>(`${SELECT} where r.id = $1`, [run.id]);
      return toView(result.rows[0]!);
    });
  }

  /** Serialize admission across API processes; different unit scopes can still execute concurrently. */
  async #claimScope(tx: PoolClient, projectId: string, applicationId: string, stage: string, inputs: Record<string, unknown>, id: string, retryCreatedAt?: Date): Promise<void> {
    if (stage !== "understand" && stage !== "design") return;
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify(["job-unit-scope", projectId, applicationId, stage])]);
    const scope = inputs["scope"] as { items?: unknown; set?: unknown } | undefined;
    const items = Array.isArray(scope?.items) ? [...new Set(scope.items.filter((item): item is string => typeof item === "string" && item.length > 0))] : [];
    if (items.length === 0 || (stage === "design" && (typeof scope?.set !== "string" || scope.set.length === 0))) {
      throw new RunScopeConflict("The run has no valid unit scope; start a new run with a selection", []);
    }
    const result = await tx.query<{ id: string; state: string; items: string[] }>(
      `select r.id, case when r.status in ('queued', 'running') then r.status
                        when w.status = 'merged' or (w.status = 'committed' and w.branch is null) then 'newer-published-output' else 'in-pr' end as state,
              r.inputs->'scope'->'items' as items
         from workflow.job_run r
         left join workflow.document_write w on w.id = r.document_write_id
        where r.project_id = $1 and r.application_id = $2 and r.name = $3
          and r.kind = 'stage' and r.parent_id is null and r.id <> $4
          and (r.inputs->'scope'->'items') ?| $5::text[]
          and ($3 <> 'design' or r.inputs->'scope'->>'set' = $6)
          and (r.status in ('queued', 'running')
            or (r.status = 'succeeded' and r.abandoned_at is null and (w.status in ('queued', 'pr-opened', 'closed', 'failed') or (w.status = 'committed' and w.branch is not null)))
            or ($7::timestamptz is not null and (w.status = 'merged' or (w.status = 'committed' and w.branch is null)) and w.updated_at >= $7))
        order by r.created_at, r.id`,
      [projectId, applicationId, stage, id, items, typeof scope?.set === "string" ? scope.set : "", retryCreatedAt ?? null],
    );
    if (result.rows.length > 0) {
      const conflicts = result.rows.map((row) => ({ runId: row.id, state: row.state, items: row.items.filter((item) => items.includes(item)) }));
      const stale = conflicts.some((entry) => entry.state === "newer-published-output");
      throw new RunScopeConflict(stale ? "The run's pinned documents predate published output for its units; start a new run" : "Selected units are already running or awaiting pull request resolution", conflicts);
    }
  }

  async abandon(projectId: string, id: string, actor: string): Promise<boolean> {
    const result = await this.#pool.query("update workflow.job_run set abandoned_at = now(), abandoned_by = $3 where project_id = $1 and id = $2 and abandoned_at is null", [projectId, id, actor]);
    return (result.rowCount ?? 0) > 0;
  }

  async inputs(projectId: string, id: string): Promise<Record<string, unknown> | undefined> {
    const result = await this.#pool.query<{ inputs: Record<string, unknown> }>("select inputs from workflow.job_run where project_id = $1 and id = $2", [projectId, id]);
    return result.rows[0]?.inputs;
  }

  async hasStageRun(projectId: string, applicationId: string, stage: string, statuses: readonly JobRunStatus[]): Promise<boolean> {
    const result = await this.#pool.query(
      "select 1 from workflow.job_run where project_id = $1 and application_id = $2 and kind = 'stage' and name = $3 and parent_id is null and status = any($4) limit 1",
      [projectId, applicationId, stage, [...statuses]],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async list(projectId: string, applicationId: string | undefined, limit: number, offset: number): Promise<{ items: JobRunView[]; total: number }> {
    const filter = "r.project_id = $1 and r.parent_id is null and ($2::text is null or r.application_id = $2)";
    const [rows, count] = await Promise.all([
      this.#pool.query<RunRow>(`${SELECT} where ${filter} order by r.created_at desc, r.id limit $3 offset $4`, [projectId, applicationId ?? null, limit, offset]),
      this.#pool.query<{ total: number }>(`select count(*)::int as total from workflow.job_run r where ${filter}`, [projectId, applicationId ?? null]),
    ]);
    return { items: rows.rows.map(toView), total: count.rows[0]?.total ?? 0 };
  }

  async listAll(filter: JobRunFilter, limit: number, offset: number): Promise<{ items: JobRunView[]; total: number }> {
    const where =
      "r.parent_id is null and ($1::text[] is null or r.status = any($1)) and ($2::text is null or r.project_id = $2) and ($3::text is null or r.application_id = $3)";
    const params = [filter.statuses === undefined || filter.statuses.length === 0 ? null : [...filter.statuses], filter.projectId ?? null, filter.applicationId ?? null];
    const [rows, count] = await Promise.all([
      this.#pool.query<RunRow>(`${SELECT} where ${where} order by r.created_at desc, r.id limit $4 offset $5`, [...params, limit, offset]),
      this.#pool.query<{ total: number }>(`select count(*)::int as total from workflow.job_run r where ${where}`, params),
    ]);
    return { items: rows.rows.map(toView), total: count.rows[0]?.total ?? 0 };
  }

  async get(projectId: string, id: string): Promise<JobRunDetail | undefined> {
    const result = await this.#pool.query<RunRow>(`${SELECT} where r.project_id = $1 and r.id = $2`, [projectId, id]);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const [steps, artifacts] = await Promise.all([
      this.#pool.query<RunRow>(`${SELECT} where r.parent_id = $1 order by r.created_at, r.id`, [id]),
      this.#pool.query<ArtifactView & { size: string }>("select path, sha256, size, provenance from workflow.artifact where job_run_id = $1 order by path", [id]),
    ]);
    return {
      ...toView(row),
      steps: steps.rows.map(toView),
      artifacts: artifacts.rows.map((artifact) => ({ path: artifact.path, sha256: artifact.sha256, size: Number(artifact.size), provenance: artifact.provenance })),
    };
  }

  async requeue(projectId: string, id: string, options: { fresh: boolean; documentsCommit?: string }): Promise<boolean> {
    return withTransaction(async (tx) => {
      // Scope and creation time are immutable. Recheck status after obtaining the admission lock:
      // concurrent retries must not both increment the attempt or enqueue the same run.
      const previous = await tx.query<{ application_id: string; name: string; inputs: Record<string, unknown>; created_at: Date }>(
        "select application_id, name, inputs, created_at from workflow.job_run where project_id = $1 and id = $2 and parent_id is null and status = 'failed'",
        [projectId, id],
      );
      const run = previous.rows[0];
      if (run === undefined) return false;
      await this.#claimScope(tx, projectId, run.application_id, run.name, run.inputs, id, run.created_at);
      const result = await tx.query(
        `update workflow.job_run
            set status = 'queued', attempt = attempt + 1, failure_reason = null, finished_at = null, started_at = null,
                cancel_requested_at = null, cancel_requested_by = null,
                inputs = inputs || jsonb_build_object('fresh', $3::boolean)
                        || case when inputs ? 'documentsCommit' or $4::text is null then '{}'::jsonb else jsonb_build_object('documentsCommit', $4::text) end
          where project_id = $1 and id = $2 and parent_id is null and status = 'failed'`,
        [projectId, id, options.fresh, options.documentsCommit ?? null],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async restricted(projectId: string, id: string): Promise<RestrictedRecordView[]> {
    const result = await this.#pool.query<{ job_run_id: string; path: string; size: string; ciphertext: string; iv: string; auth_tag: string; created_at: Date }>(
      `select x.job_run_id, x.path, x.size, x.ciphertext, x.iv, x.auth_tag, x.created_at
         from governance.restricted_record x
         join workflow.job_run r on r.id = x.job_run_id
        where r.project_id = $1 and (r.id = $2 or r.parent_id = $2)
        order by x.created_at, x.path`,
      [projectId, id],
    );
    return result.rows.map((row) => {
      const plaintext = decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
      return {
        jobRunId: row.job_run_id,
        path: row.path,
        size: Number(row.size),
        content: plaintext.startsWith("base64:") ? Buffer.from(plaintext.slice("base64:".length), "base64").toString("utf8") : plaintext,
        createdAt: row.created_at.toISOString(),
      };
    });
  }

  async restrictedSummaries(filter: RestrictedRecordFilter, limit: number, offset: number): Promise<{ items: RestrictedRecordSummary[]; total: number }> {
    // Metadata only: the ciphertext columns are never selected.
    const from = `from governance.restricted_record x
      join workflow.job_run r on r.id = x.job_run_id
      join workflow.job_run t on t.id = coalesce(r.parent_id, r.id)
     where ($1::text is null or r.project_id = $1) and ($2::text is null or t.id = $2)`;
    const params = [filter.projectId ?? null, filter.jobRunId ?? null];
    const [rows, count] = await Promise.all([
      this.#pool.query<{
        job_run_id: string;
        top_level_run_id: string;
        project_id: string;
        application_id: string | null;
        run_name: string;
        step_name: string | null;
        path: string;
        size: string;
        created_at: Date;
      }>(
        `select x.job_run_id, t.id as top_level_run_id, r.project_id, coalesce(r.application_id, t.application_id) as application_id, t.name as run_name,
                case when r.parent_id is null then null else r.name end as step_name, x.path, x.size, x.created_at
           ${from}
          order by x.created_at desc, x.job_run_id, x.path limit $3 offset $4`,
        [...params, limit, offset],
      ),
      this.#pool.query<{ total: number }>(`select count(*)::int as total ${from}`, params),
    ]);
    return {
      items: rows.rows.map((row) => ({
        jobRunId: row.job_run_id,
        topLevelRunId: row.top_level_run_id,
        projectId: row.project_id,
        ...optional("applicationId", row.application_id),
        runName: row.run_name,
        ...optional("stepName", row.step_name),
        path: row.path,
        size: Number(row.size),
        createdAt: row.created_at.toISOString(),
      })),
      total: count.rows[0]?.total ?? 0,
    };
  }

  async summary(projectId: string, id: string): Promise<JobRunView | undefined> {
    const result = await this.#pool.query<RunRow>(`${SELECT} where r.project_id = $1 and r.id = $2`, [projectId, id]);
    const row = result.rows[0];
    return row === undefined ? undefined : toView(row);
  }

  async cancel(projectId: string, id: string, actor: string): Promise<CancelOutcome> {
    return withTransaction(async (client) => {
      // Queued: the worker has not started it; it skips runs that are no longer queued.
      const queued = await client.query(
        `update workflow.job_run set status = 'cancelled', finished_at = now(), cancel_requested_at = now(), cancel_requested_by = $3
          where project_id = $1 and id = $2 and status = 'queued'`,
        [projectId, id, actor],
      );
      if ((queued.rowCount ?? 0) > 0) {
        await client.query("insert into workflow.job_event (job_run_id, kind, message, data) values ($1, 'status', 'cancelled before it started', $2)", [
          id,
          JSON.stringify({ status: "cancelled" }),
        ]);
        return "cancelled";
      }
      // Running: the worker that runs it notices the request and kills its processes.
      const running = await client.query(
        `update workflow.job_run set cancel_requested_at = coalesce(cancel_requested_at, now()), cancel_requested_by = coalesce(cancel_requested_by, $3)
          where project_id = $1 and id = $2 and status = 'running'`,
        [projectId, id, actor],
      );
      if ((running.rowCount ?? 0) > 0) {
        await client.query("insert into workflow.job_event (job_run_id, kind, message, data) values ($1, 'log', 'cancel requested', '{}')", [id]);
        return "requested";
      }
      return "finished";
    });
  }

  async events(id: string, afterId: string | undefined, limit: number): Promise<JobRunEventView[]> {
    const result = await this.#pool.query<{ id: string; at: Date; kind: JobRunEventKind; message: string; step_run_id: string | null; attempt: number; data: Record<string, unknown> }>(
      `select id::text, at, kind, message, step_run_id, attempt, data from workflow.job_event
        where job_run_id = $1 and id > $2 order by id limit $3`,
      [id, afterId ?? "0", limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      kind: row.kind,
      message: row.message,
      ...optional("stepRunId", row.step_run_id),
      attempt: row.attempt,
      data: row.data,
    }));
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.#pool.query("update workflow.job_run set status = 'failed', failure_reason = $2, finished_at = now() where id = $1", [id, reason.slice(0, 2000)]);
  }
}
