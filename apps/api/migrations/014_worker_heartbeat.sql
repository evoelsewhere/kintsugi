-- workflow domain: worker heartbeats (ADR-0030). Every kintsugi-worker process upserts its row
-- every 15 seconds and marks it stopped on a clean shutdown; the API reads the table to tell
-- whether a worker is up (seen less than 45 seconds ago, by the database clock) instead of
-- guessing from queue activity.
--
--   worker_heartbeat   one row per worker process: where it runs (host, pid), what it is
--                      (version), when it started and was last seen, how many jobs it is
--                      running and which queues it works. Rows of workers gone for more than
--                      7 days are removed by the next worker that starts.

create schema if not exists workflow;

create table workflow.worker_heartbeat (
  worker_id text primary key,
  host text not null,
  pid integer not null,
  version text not null,
  started_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  -- set by a clean shutdown; a crashed worker simply stops being seen
  stopped_at timestamptz,
  -- jobs in progress in this process (job runs, document writes, Git syncs)
  active_jobs integer not null default 0 check (active_jobs >= 0),
  -- the pg-boss queues this process works
  queues text[] not null default '{}'
);

create index worker_heartbeat_last_seen on workflow.worker_heartbeat (last_seen_at desc);
