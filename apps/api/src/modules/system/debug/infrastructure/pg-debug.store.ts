// Postgres adapter of the debug store (ADR-0056). Every statement reads; `query` runs the caller's statement in a
// read-only transaction. Text that can be long (a task, a summary, an error) is cut, never dropped silently.

import { Injectable } from "@nestjs/common";
import { QUEUE_SCHEMA } from "@kintsugi/orchestrator/queues";
import { getPool } from "#common/db/pool.js";
import { getJobQueue } from "#common/queue/job-queue.js";
import { readBuildInfo } from "#modules/system/health/index.js";
import { DebugStore, type EventQuery, type Json, type LogQuery, type RunFilter } from "../domain/debug.js";

const BUILD = readBuildInfo();
const LEVEL_RANK: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const levelsFrom = (minimum: string): string[] => Object.entries(LEVEL_RANK).filter(([, rank]) => rank >= (LEVEL_RANK[minimum] ?? 0)).map(([level]) => level);

/** Strings longer than `max` are cut, with the length said; the structure stays. */
export function clip(value: unknown, max = 2000): unknown {
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}… [${value.length} characters]` : value;
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => clip(entry, max));
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clip(entry, max)]));
  return value;
}

const iso = (value: unknown): string | null => (value instanceof Date ? value.toISOString() : value === null || value === undefined ? null : String(value));

function row(record: Record<string, unknown>): Json {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
}

/** Tables that hold encrypted secrets or their keys: `query` refuses a statement that names one. */
const SECRET_TABLES = /(restricted_record|mcp_secret|secret|credential|llm_provider|git_server|session|password)/i;
const FORBIDDEN_FUNCTIONS = /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|lo_get|dblink|copy)\b/i;

@Injectable()
export class PgDebugStore extends DebugStore {
  get #pool() {
    return getPool();
  }

  async runs(filter: RunFilter): Promise<Json[]> {
    const result = await this.#pool.query(
      `select r.id, r.project_id, r.application_id, r.name, r.status, r.attempt, left(r.failure_reason, 300) as failure_reason,
              r.actor, r.started_at, r.finished_at, r.created_at,
              (select count(*)::int from workflow.job_run c where c.parent_id = r.id) as steps,
              (select count(*)::int from workflow.job_run c where c.parent_id = r.id and c.status = 'failed') as failed_steps
         from workflow.job_run r
        where r.parent_id is null and ($1::text is null or r.project_id = $1) and ($2::text is null or r.application_id = $2)
          and ($3::text[] is null or r.status = any($3))
        order by r.created_at desc, r.id limit $4`,
      [filter.projectId ?? null, filter.applicationId ?? null, filter.statuses === undefined || filter.statuses.length === 0 ? null : [...filter.statuses], filter.limit],
    );
    return result.rows.map(row);
  }

  async run(runId: string): Promise<Json | undefined> {
    const run = await this.#pool.query(
      `select r.*, w.status as write_status, w.branch as write_branch, w.pr_url as write_pr_url, left(w.error, 500) as write_error
         from workflow.job_run r left join workflow.document_write w on w.id = r.document_write_id where r.id = $1`,
      [runId],
    );
    const head = run.rows[0] as Record<string, unknown> | undefined;
    if (head === undefined) return undefined;
    const [steps, artifacts, restricted] = await Promise.all([
      this.#pool.query(
        `select id, kind, name, status, agent, inputs->>'label' as label, left(failure_reason, 400) as failure_reason, started_at, finished_at,
                output_summary->'usage' as usage, output_summary->>'reused' as reused
           from workflow.job_run where parent_id = $1 order by created_at, id`,
        [runId],
      ),
      this.#pool.query("select count(*)::int as files, coalesce(sum(size), 0)::bigint as bytes from workflow.artifact where job_run_id = $1", [runId]),
      this.#pool.query("select count(*)::int as n from governance.restricted_record r join workflow.job_run j on j.id = r.job_run_id where j.id = $1 or j.parent_id = $1", [runId]),
    ]);
    const { inputs, output_summary: summary, failure_reason: failure, ...rest } = head;
    return {
      ...row(rest),
      failureReason: failure ?? null,
      inputs: clip(inputs, 600),
      summary: clip(summary, 600),
      write: head["write_status"] === null ? null : { status: head["write_status"], branch: head["write_branch"], prUrl: head["write_pr_url"], error: head["write_error"] },
      steps: steps.rows.map(row),
      artifacts: { ...(artifacts.rows[0] as Json), bytes: Number((artifacts.rows[0] as { bytes: string }).bytes) },
      restrictedRecords: (restricted.rows[0] as { n: number }).n,
    };
  }

  async step(stepId: string): Promise<Json | undefined> {
    const result = await this.#pool.query("select * from workflow.job_run where id = $1", [stepId]);
    const step = result.rows[0] as Record<string, unknown> | undefined;
    if (step === undefined) return undefined;
    const { inputs, output_summary: summary, ...rest } = step;
    return { ...row(rest), inputs: clip(inputs, 8000), summary: clip(summary, 3000) };
  }

  async events(query: EventQuery): Promise<Json[]> {
    const params: unknown[] = [query.runId];
    const where = ["job_run_id = $1"];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (query.cursor !== undefined) add(query.order === "asc" ? "id > ?::bigint" : "id < ?::bigint", query.cursor);
    if (query.kinds !== undefined && query.kinds.length > 0) add("kind = any(?::text[])", [...query.kinds]);
    if (query.stepId !== undefined) add("step_run_id = ?", query.stepId);
    if (query.attempt !== undefined) add("attempt = ?", query.attempt);
    if (query.text !== undefined) add("message ilike '%' || ? || '%'", query.text);
    params.push(query.limit);
    const result = await this.#pool.query(
      `select id::text, at, kind, attempt, step_run_id, message, data from workflow.job_event where ${where.join(" and ")} order by id ${query.order === "asc" ? "asc" : "desc"} limit $${params.length}`,
      params,
    );
    return result.rows.map((entry) => row(entry as Record<string, unknown>));
  }

  async failure(runId: string): Promise<Json | undefined> {
    const head = (await this.#pool.query("select id, name, status, attempt, left(failure_reason, 1000) as failure_reason, attempts, started_at, finished_at, application_id from workflow.job_run where id = $1", [runId])).rows[0] as
      | Record<string, unknown>
      | undefined;
    if (head === undefined) return undefined;
    const attempt = Number(head["attempt"]);
    const [failedSteps, lastEvents, problemEvents] = await Promise.all([
      this.#pool.query(
        `select id, kind, name, agent, inputs->>'label' as label, left(failure_reason, 1000) as failure_reason, started_at, finished_at
           from workflow.job_run where parent_id = $1 and status = 'failed' order by created_at limit 10`,
        [runId],
      ),
      this.#pool.query(
        `select id::text, at, kind, step_run_id, message from (
           select * from workflow.job_event where job_run_id = $1 and attempt = $2 and message not like 'model working:%' order by id desc limit 40
         ) e order by id`,
        [runId, attempt],
      ),
      this.#pool.query(
        `select id::text, at, kind, step_run_id, message from workflow.job_event
          where job_run_id = $1 and attempt = $2 and (message like '%failed%' or message like 'blocked:%' or message like '%stalled%' or message like '%asking it to%') order by id limit 25`,
        [runId, attempt],
      ),
    ]);
    // What the services logged while the run was going (warnings and errors), when the log capture is on.
    const started = head["started_at"] as Date | null;
    const finished = (head["finished_at"] as Date | null) ?? new Date();
    const logs =
      started === null
        ? { rows: [] }
        : await this.#pool.query(
            `select id::text, at, service, level, left(message, 400) as message from monitoring.debug_log
              where level in ('warn', 'error') and at between $1 and $2::timestamptz + interval '1 minute' order by id limit 30`,
            [started, finished],
          );
    return {
      run: row(head),
      failedSteps: failedSteps.rows.map(row),
      lastEvents: lastEvents.rows.map((entry) => row(entry as Record<string, unknown>)),
      problemEvents: problemEvents.rows.map((entry) => row(entry as Record<string, unknown>)),
      serviceLogWarnings: logs.rows.map((entry) => row(entry as Record<string, unknown>)),
    };
  }

  async telemetry(runId: string): Promise<Json> {
    const [steps, errors] = await Promise.all([
      this.#pool.query(
        `select step_run_id, max(agent) as agent, max(provider) || '/' || max(model) as model, attempt,
                count(*) filter (where name = 'kintsugi.turn')::int as turns, count(*) filter (where name = 'kintsugi.tool')::int as tool_calls,
                count(*) filter (where name = 'kintsugi.retry')::int as retries, count(*) filter (where status = 'error')::int as errors,
                coalesce(sum(duration_ms) filter (where name = 'kintsugi.job'), 0)::int as job_ms
           from monitoring.telemetry_span where job_run_id = $1 group by step_run_id, attempt order by min(started_at)`,
        [runId],
      ),
      this.#pool.query(
        "select step_run_id, attempt, name, started_at, left(error, 400) as error from monitoring.telemetry_span where job_run_id = $1 and status = 'error' order by started_at desc limit 20",
        [runId],
      ),
    ]);
    return { perStep: steps.rows.map((entry) => row(entry as Record<string, unknown>)), errors: errors.rows.map((entry) => row(entry as Record<string, unknown>)) };
  }

  async logs(query: LogQuery): Promise<Json[]> {
    const params: unknown[] = [levelsFrom(query.minLevel)];
    const where = ["level = any($1)"];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (query.service !== undefined) add("service = ?", query.service);
    if (query.since !== undefined) add("at >= ?", query.since);
    if (query.until !== undefined) add("at <= ?", query.until);
    if (query.pattern !== undefined) add("message ~* ?", query.pattern);
    params.push(query.limit);
    const result = await this.#pool.query(`select id::text, at, service, level, message from (select * from monitoring.debug_log where ${where.join(" and ")} order by id desc limit $${params.length}) l order by id`, params);
    return result.rows.map((entry) => row(entry as Record<string, unknown>));
  }

  async logsAround(id: string, before: number, after: number): Promise<Json[]> {
    const result = await this.#pool.query(
      `with hit as (select id, service from monitoring.debug_log where id = $1::bigint)
       select * from (
         (select l.id::text, l.at, l.service, l.level, l.message from monitoring.debug_log l, hit where l.service = hit.service and l.id < hit.id order by l.id desc limit $2)
         union all (select l.id::text, l.at, l.service, l.level, l.message from monitoring.debug_log l, hit where l.id = hit.id)
         union all (select l.id::text, l.at, l.service, l.level, l.message from monitoring.debug_log l, hit where l.service = hit.service and l.id > hit.id order by l.id limit $3)
       ) lines order by id::bigint`,
      [id, before, after],
    );
    return result.rows.map((entry) => row(entry as Record<string, unknown>));
  }

  async logCapture(): Promise<Json> {
    const result = await this.#pool.query("select service, count(*)::int as lines, min(at) as oldest, max(at) as newest, count(*) filter (where level = 'error')::int as errors from monitoring.debug_log group by service order by service");
    return { services: result.rows.map((entry) => row(entry as Record<string, unknown>)) };
  }

  async status(): Promise<Json> {
    const pool = this.#pool;
    const [db, workers, runs, repositories, applied] = await Promise.all([
      pool.query("select version() as version, now() as now, pg_database_size(current_database())::bigint as bytes, (select count(*)::int from pg_stat_activity where datname = current_database()) as connections"),
      pool.query(
        `select worker_id, host, pid, version, started_at, last_seen_at, stopped_at, active_jobs, queues,
                extract(epoch from (now() - last_seen_at))::int as seconds_since_seen
           from workflow.worker_heartbeat order by last_seen_at desc limit 10`,
      ),
      pool.query(
        `select status, count(*)::int as n, min(created_at) as oldest from workflow.job_run
          where parent_id is null and (status in ('queued', 'running') or created_at > now() - interval '24 hours') group by status order by status`,
      ),
      pool.query("select sync_status, count(*)::int as n from admin.git_repository group by sync_status order by sync_status"),
      pool.query("select count(*)::int as n, max(version) as latest from core.schema_migrations"),
    ]);
    const database = db.rows[0] as Record<string, unknown>;
    const memory = process.memoryUsage();
    return {
      api: { service: "kintsugi-api", node: process.version, pid: process.pid, uptimeSeconds: Math.round(process.uptime()), build: BUILD, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, debugMcp: true },
      database: { version: String(database["version"]).split(" ").slice(0, 2).join(" "), now: iso(database["now"]), sizeBytes: Number(database["bytes"]), connections: database["connections"], migrations: applied.rows[0] },
      workers: workers.rows.map((entry) => {
        const worker = entry as Record<string, unknown>;
        return { ...row(worker), up: worker["stopped_at"] === null && Number(worker["seconds_since_seen"]) < 45 };
      }),
      runsLast24hAndActive: runs.rows.map((entry) => row(entry as Record<string, unknown>)),
      repositoriesBySync: repositories.rows,
    };
  }

  async queues(): Promise<Json> {
    const boss = await getJobQueue();
    const counts = (await boss.getQueues()).map((queue) => ({ name: queue.name, queued: queue.queuedCount, active: queue.activeCount, deferred: queue.deferredCount, total: queue.totalCount }));
    // The jobs behind the counts, when the table is the one this version of pg-boss has.
    const failures = await this.#pool
      .query(
        `select id, name, state, retry_count, created_on, started_on, completed_on, left(output::text, 600) as output
           from ${QUEUE_SCHEMA}.job where state in ('failed', 'retry') order by created_on desc limit 15`,
      )
      .then(
        (result): unknown => result.rows.map((entry) => row(entry as Record<string, unknown>)),
        (error: unknown): unknown => ({ unavailable: error instanceof Error ? error.message : String(error) }),
      );
    return { queues: counts, recentFailures: failures };
  }

  async repositories(): Promise<Json[]> {
    const result = await this.#pool.query(
      `select id, server_id, default_branch, sync_status, last_commit, last_synced_at, left(last_error, 500) as last_error, updated_at
         from admin.git_repository order by (sync_status = 'error') desc, id`,
    );
    return result.rows.map((entry) => row(entry as Record<string, unknown>));
  }

  async runStates(ids: readonly string[]): Promise<Map<string, Json>> {
    if (ids.length === 0) return new Map();
    const result = await this.#pool.query(
      "select id, name, status, attempt, application_id, finished_at, left(failure_reason, 200) as failure_reason from workflow.job_run where id = any($1)",
      [[...ids]],
    );
    return new Map(result.rows.map((entry) => [(entry as { id: string }).id, row(entry as Record<string, unknown>)]));
  }

  async tables(schema: string | undefined, table: string | undefined): Promise<Json> {
    if (schema !== undefined && table !== undefined) {
      const columns = await this.#pool.query(
        "select column_name as name, data_type as type, is_nullable = 'YES' as nullable, column_default as default from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position",
        [schema, table],
      );
      return { schema, table, columns: columns.rows.map((entry) => clip(entry, 200)) };
    }
    const result = await this.#pool.query(
      `select n.nspname as schema, c.relname as table, c.reltuples::bigint as estimated_rows
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
          and ($1::text is null or n.nspname = $1) order by n.nspname, c.relname`,
      [schema ?? null],
    );
    return { tables: result.rows.map((entry) => row(entry as Record<string, unknown>)) };
  }

  async query(sql: string, limit: number): Promise<Json> {
    if (SECRET_TABLES.test(sql)) throw new Error("The statement names a table that holds secrets or sessions; this tool does not read them");
    if (FORBIDDEN_FUNCTIONS.test(sql)) throw new Error("The statement uses a function that reads files or copies data out of the server");
    const client = await this.#pool.connect();
    try {
      await client.query("begin read only");
      await client.query("set local statement_timeout = '5s'");
      const result = await client.query({ text: `select * from (${sql.replace(/;\s*$/, "")}) as q limit ${limit + 1}`, rowMode: "array" });
      await client.query("rollback");
      const columns = result.fields.map((field) => field.name);
      const rows = (result.rows as unknown[][]).slice(0, limit).map((values) => Object.fromEntries(columns.map((name, index) => [name, clip(values[index], 500)])));
      return { columns, rows, truncated: result.rows.length > limit };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
