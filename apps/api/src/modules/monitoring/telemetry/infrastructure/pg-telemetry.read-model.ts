// Postgres read model of the runtime telemetry (ADR-0048): aggregates over monitoring.telemetry_span
// (migration 020). Totals come from each attempt's root span (`kintsugi.job`), which carries the
// job's sums, so a span is never counted twice; tool statistics come from the tool spans. Read-only;
// the window uses the stored span start times.

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool } from "#common/db/pool.js";
import { type Page, toPage } from "#common/application/pagination.js";
import type {
  TelemetryBreakdown,
  TelemetryDay,
  TelemetryFilter,
  TelemetryRun,
  TelemetryRunsFilter,
  TelemetrySummary,
  TelemetryToolStat,
  TelemetryTotals,
  Trace,
  TraceSpan,
} from "../domain/telemetry.js";
import { TelemetryReadModel } from "../domain/telemetry.ports.js";

const TOOL_SPANS = "('kintsugi.tool', 'kintsugi.codemode', 'kintsugi.mcp')";
const MAX_TRACE_SPANS = 5000;

/** `attributes->>name` as a number; null when the span has no such attribute. */
const num = (name: string): string => `(attributes->>'${name}')::float8`;
/** Sum of an attribute across the rows of a group, 0 when none. */
const total = (name: string): string => `coalesce(sum(${num(name)}), 0)::float8`;

function scope(filter: TelemetryFilter): { sql: string; params: unknown[] } {
  const params: unknown[] = [filter.from, filter.to];
  let sql = "started_at >= $1 and started_at < $2";
  if (filter.projectId !== undefined) {
    params.push(filter.projectId);
    sql += ` and project_id = $${params.length}`;
  }
  if (filter.agent !== undefined) {
    params.push(filter.agent);
    sql += ` and (agent = $${params.length} or agent like $${params.length} || '@%')`;
  }
  return { sql, params };
}

const rate = (read: number, input: number, write: number): number | null => (read + input + write > 0 ? read / (read + input + write) : null);

interface BreakdownRow {
  key: string;
  jobs: number;
  failed: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost: number;
  compactions: number;
}

const toBreakdown = (row: BreakdownRow): TelemetryBreakdown => ({
  key: row.key,
  jobs: row.jobs,
  failedJobs: row.failed,
  inputTokens: row.input,
  outputTokens: row.output,
  cacheReadTokens: row.cache_read,
  cacheWriteTokens: row.cache_write,
  costUsd: row.cost,
  compactions: row.compactions,
});

const BREAKDOWN_COLUMNS = `count(*)::int as jobs, count(*) filter (where status = 'error')::int as failed,
  ${total("inputTokens")} as input, ${total("outputTokens")} as output, ${total("cacheReadTokens")} as cache_read,
  ${total("cacheWriteTokens")} as cache_write, ${total("costUsd")} as cost, ${total("compactions")}::int as compactions`;

interface RunRow {
  job_run_id: string;
  step_run_id: string | null;
  project_id: string;
  application_id: string | null;
  agent: string;
  provider: string;
  model: string;
  attempt: number;
  started_at: Date;
  duration_ms: number;
  status: "ok" | "error";
  error: string | null;
  attributes: Record<string, string | number | boolean>;
}

const numberOf = (value: string | number | boolean | undefined): number => (typeof value === "number" ? value : 0);

const toRun = (row: RunRow): TelemetryRun => {
  const a = row.attributes;
  return {
    runId: row.job_run_id,
    stepRunId: row.step_run_id,
    projectId: row.project_id,
    applicationId: row.application_id,
    agent: row.agent,
    provider: row.provider,
    model: row.model,
    attempt: row.attempt,
    startedAt: row.started_at.toISOString(),
    durationMs: row.duration_ms,
    status: row.status,
    outcome: typeof a["outcome"] === "string" ? a["outcome"] : row.status === "ok" ? "completed" : "error",
    error: row.error,
    turns: numberOf(a["turns"]),
    inputTokens: numberOf(a["inputTokens"]),
    outputTokens: numberOf(a["outputTokens"]),
    cacheReadTokens: numberOf(a["cacheReadTokens"]),
    cacheWriteTokens: numberOf(a["cacheWriteTokens"]),
    costUsd: numberOf(a["costUsd"]),
    compactions: numberOf(a["compactions"]),
    contextPeakPercent: typeof a["contextPeakPercent"] === "number" ? a["contextPeakPercent"] : null,
  };
};

@Injectable()
export class PgTelemetryReadModel extends TelemetryReadModel {
  get #pool(): Pool {
    return getPool();
  }

  async summary(filter: TelemetryFilter): Promise<TelemetrySummary> {
    const { sql, params } = scope(filter);
    const query = <T extends object>(text: string): Promise<T[]> => this.#pool.query<T>(text, params).then((result) => result.rows);
    const [roots, others, daily, byAgent, byModel, reasons, tools] = await Promise.all([
      query<{ jobs: number; failed: number; overflow: number; turns: number; input: number; output: number; cache_read: number; cache_write: number; cost: number; compactions: number }>(
        `select count(*)::int as jobs, count(*) filter (where status = 'error')::int as failed,
                count(*) filter (where attributes->>'outcome' = 'context-overflow')::int as overflow,
                ${total("turns")} as turns, ${total("inputTokens")} as input, ${total("outputTokens")} as output,
                ${total("cacheReadTokens")} as cache_read, ${total("cacheWriteTokens")} as cache_write,
                ${total("costUsd")} as cost, ${total("compactions")} as compactions
           from monitoring.telemetry_span where name = 'kintsugi.job' and ${sql}`,
      ),
      query<{ retries: number; tool_calls: number; tool_errors: number; p95: number | null; codemode: number; mcp: number }>(
        `select count(*) filter (where name = 'kintsugi.retry')::int as retries,
                count(*) filter (where name in ${TOOL_SPANS})::int as tool_calls,
                count(*) filter (where name in ${TOOL_SPANS} and status = 'error')::int as tool_errors,
                percentile_cont(0.95) within group (order by duration_ms) filter (where name in ${TOOL_SPANS})::float8 as p95,
                count(*) filter (where name = 'kintsugi.codemode')::int as codemode,
                count(*) filter (where name = 'kintsugi.mcp')::int as mcp
           from monitoring.telemetry_span where ${sql}`,
      ),
      query<{ day: string; jobs: number; input: number; output: number; cache_read: number; cache_write: number; cost: number }>(
        `select to_char(date_trunc('day', started_at at time zone 'UTC'), 'YYYY-MM-DD') as day, count(*)::int as jobs,
                ${total("inputTokens")} as input, ${total("outputTokens")} as output, ${total("cacheReadTokens")} as cache_read,
                ${total("cacheWriteTokens")} as cache_write, ${total("costUsd")} as cost
           from monitoring.telemetry_span where name = 'kintsugi.job' and ${sql} group by 1 order by 1`,
      ),
      query<BreakdownRow>(
        `select agent as key, ${BREAKDOWN_COLUMNS} from monitoring.telemetry_span where name = 'kintsugi.job' and ${sql} group by agent order by cost desc, jobs desc limit 50`,
      ),
      query<BreakdownRow>(
        `select provider || '/' || model as key, ${BREAKDOWN_COLUMNS} from monitoring.telemetry_span where name = 'kintsugi.job' and ${sql} group by provider, model order by cost desc, jobs desc limit 50`,
      ),
      query<{ reason: string; count: number }>(
        `select coalesce(attributes->>'reason', 'unknown') as reason, count(*)::int as count
           from monitoring.telemetry_span where name = 'kintsugi.compaction' and ${sql} group by 1 order by 2 desc`,
      ),
      query<{ tool: string; calls: number; errors: number; p95: number | null }>(
        `select coalesce(attributes->>'tool', name) as tool, count(*)::int as calls, count(*) filter (where status = 'error')::int as errors,
                percentile_cont(0.95) within group (order by duration_ms)::float8 as p95
           from monitoring.telemetry_span where name in ${TOOL_SPANS} and ${sql} group by 1 order by calls desc, tool limit 12`,
      ),
    ]);
    const r = roots[0]!;
    const o = others[0]!;
    const totals: TelemetryTotals = {
      jobs: r.jobs,
      failedJobs: r.failed,
      overflowFailures: r.overflow,
      turns: r.turns,
      inputTokens: r.input,
      outputTokens: r.output,
      cacheReadTokens: r.cache_read,
      cacheWriteTokens: r.cache_write,
      costUsd: r.cost,
      cacheHitRate: rate(r.cache_read, r.input, r.cache_write),
      compactions: r.compactions,
      retries: o.retries,
      toolCalls: o.tool_calls,
      toolErrors: o.tool_errors,
      toolP95Ms: o.p95 === null ? null : Math.round(o.p95),
      codemodeCalls: o.codemode,
      mcpCalls: o.mcp,
    };
    return {
      from: filter.from.toISOString(),
      to: filter.to.toISOString(),
      totals,
      daily: daily.map(
        (row): TelemetryDay => ({ day: row.day, jobs: row.jobs, inputTokens: row.input, outputTokens: row.output, cacheReadTokens: row.cache_read, cacheWriteTokens: row.cache_write, costUsd: row.cost }),
      ),
      byAgent: byAgent.map(toBreakdown),
      byModel: byModel.map(toBreakdown),
      compactionReasons: reasons,
      tools: tools.map((row): TelemetryToolStat => ({ tool: row.tool, calls: row.calls, errors: row.errors, p95Ms: row.p95 === null ? null : Math.round(row.p95) })),
    };
  }

  async runs(filter: TelemetryRunsFilter): Promise<Page<TelemetryRun>> {
    const { sql, params } = scope(filter);
    let where = `name = 'kintsugi.job' and ${sql}`;
    if (filter.status !== undefined) {
      params.push(filter.status);
      where += ` and status = $${params.length}`;
    }
    if (filter.runId !== undefined) {
      params.push(filter.runId);
      where += ` and job_run_id = $${params.length}`;
    }
    const [rows, count] = await Promise.all([
      this.#pool.query<RunRow>(
        `select job_run_id, step_run_id, project_id, application_id, agent, provider, model, attempt, started_at, duration_ms, status, error, attributes
           from monitoring.telemetry_span where ${where} order by started_at desc, id desc limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, filter.limit, filter.offset],
      ),
      this.#pool.query<{ count: number }>(`select count(*)::int as count from monitoring.telemetry_span where ${where}`, params),
    ]);
    return toPage(rows.rows.map(toRun), count.rows[0]?.count ?? 0, filter);
  }

  async trace(runId: string, options: { step?: string; attempt?: number }): Promise<Trace | undefined> {
    const params: unknown[] = [runId];
    let where = "job_run_id = $1";
    if (options.step !== undefined) {
      params.push(options.step);
      where += ` and step_run_id = $${params.length}`;
    }
    if (options.attempt !== undefined) {
      params.push(options.attempt);
      where += ` and attempt = $${params.length}`;
    }
    const result = await this.#pool.query<{
      step_run_id: string | null;
      attempt: number;
      span_id: string;
      parent_span_id: string | null;
      name: string;
      started_at: Date;
      duration_ms: number;
      status: "ok" | "error";
      error: string | null;
      attributes: Record<string, string | number | boolean>;
    }>(
      `select step_run_id, attempt, span_id, parent_span_id, name, started_at, duration_ms, status, error, attributes
         from monitoring.telemetry_span where ${where} order by started_at, id limit ${MAX_TRACE_SPANS + 1}`,
      params,
    );
    if (result.rows.length === 0) return undefined;
    const spans: TraceSpan[] = result.rows.slice(0, MAX_TRACE_SPANS).map((row) => ({
      step: row.step_run_id,
      attempt: row.attempt,
      spanId: row.span_id,
      parentSpanId: row.parent_span_id,
      name: row.name,
      startedAt: row.started_at.toISOString(),
      durationMs: row.duration_ms,
      status: row.status,
      error: row.error,
      attributes: row.attributes,
    }));
    return { runId, spans, truncated: result.rows.length > MAX_TRACE_SPANS };
  }
}
