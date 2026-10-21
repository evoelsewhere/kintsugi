-- Durable sweep scheduling for the Coding Agent Workflow provider inbox.
-- A partial cursor is resumable; only a complete sweep advances updated_at_watermark.

alter table workflow.member_provider_sync_watermark
  add column sweep_mode text check (sweep_mode is null or sweep_mode in ('incremental', 'deep')),
  add column deep_backfill_started_at timestamptz,
  add column last_deep_backfill_at timestamptz,
  add column next_poll_at timestamptz not null default 'epoch',
  add column consecutive_failures integer not null default 0 check (consecutive_failures >= 0);

create index member_provider_sync_due_idx
  on workflow.member_provider_sync_watermark (next_poll_at, repository_id);

-- The HMAC authenticates request bytes, not X-GitHub-Delivery. A payload hash
-- uniqueness guard prevents a captured signed body from scheduling repeated scans
-- with attacker-chosen delivery IDs.
create unique index member_provider_delivery_payload_uq
  on workflow.member_provider_delivery (server_id, payload_sha256);
