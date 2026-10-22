-- workflow domain: a job keeps its workspace and its id across attempts (ADR-0055).
--
--   job_run.attempt         1 for the first attempt; a retry of a failed stage run puts the same run back in the
--                           queue with attempt + 1 (its pinned sources, documents commit and scope do not change)
--   job_run.attempts        what each finished attempt did, oldest first:
--                           [{ "n": 1, "startedAt": "...", "finishedAt": "...", "status": "failed", "reason": "..." }, ...]
--   job_event.attempt       the attempt of the run an event belongs to
--   telemetry_span.run_attempt   the attempt of the run a span belongs to; the span's own `attempt` is the retry
--                           of one agent inside a step and keeps its meaning
--
-- Retries recorded before this migration were runs of their own (`inputs.resumeOf`); they stay as they were.

alter table workflow.job_run
  add column attempt integer not null default 1 check (attempt >= 1),
  add column attempts jsonb not null default '[]'::jsonb check (jsonb_typeof(attempts) = 'array');

alter table workflow.job_event
  add column attempt integer not null default 1 check (attempt >= 1);

alter table monitoring.telemetry_span
  add column run_attempt integer not null default 1 check (run_attempt >= 1);
