-- monitoring domain: the telemetry of runtime jobs (ADR-0048). The agent kernel reports a span for
-- the job, each model turn, each tool call (codemode and MCP calls included), each compaction and
-- each retry (`packages/runtime-sdk`, `JobSpan`); the worker stores them here as they arrive, so the
-- portal can show tokens, cache hits, cost and latency per project, agent and model, and the trace
-- of one job. The spans carry counts, sizes and names only: never prompts, tool arguments or output.
--
--   telemetry_span   one settled span of one agent attempt. `job_run_id` is the top-level run (the
--                    stage), `step_run_id` the agent step; a retried step records each attempt.
--                    Spans of a job form a tree through `span_id` / `parent_span_id` (ids are
--                    unique within one attempt, not across attempts).
--
-- Rows are pruned by the worker after KINTSUGI_TELEMETRY_RETENTION_DAYS (default 30).
--
-- core domain: reading telemetry needs the `telemetry.view` permission (seeded in 002_identity.sql).

create schema if not exists monitoring;

create table monitoring.telemetry_span (
  id bigserial primary key,
  job_run_id text not null references workflow.job_run(id) on delete cascade,
  step_run_id text,
  project_id text not null references admin.project(id) on delete cascade,
  application_id text,
  -- `<agent>@<version>`, the provider config id and the model id the job used
  agent text not null default '',
  provider text not null default '',
  model text not null default '',
  attempt integer not null default 1 check (attempt >= 1),
  span_id text not null,
  parent_span_id text,
  -- kintsugi.job, kintsugi.turn, kintsugi.tool, kintsugi.codemode, kintsugi.mcp, kintsugi.compaction, kintsugi.retry
  name text not null,
  started_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  status text not null check (status in ('ok', 'error')),
  error text,
  -- scalars only: token counts, cost, tool name, reasons
  attributes jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);

create index telemetry_span_project_time on monitoring.telemetry_span (project_id, started_at desc);
create index telemetry_span_run on monitoring.telemetry_span (job_run_id, step_run_id, attempt, id);
create index telemetry_span_name_time on monitoring.telemetry_span (name, started_at desc);
create index telemetry_span_agent_time on monitoring.telemetry_span (agent, started_at desc);
