-- Durable Coding Agent Workflow state transitions, project events and queue intents.
-- Events are operational indexes of Git-owned evidence; they do not replace Git as source of truth.

create table workflow.member_transition (
  transition_key text primary key check (length(transition_key) between 1 and 200),
  project_id text not null references admin.project(id) on delete cascade,
  unit_id text check (unit_id is null or length(unit_id) between 1 and 500),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (transition_key, project_id)
);
create index workflow_member_transition_project_idx
  on workflow.member_transition (project_id, created_at desc);

create table workflow.member_event_cursor (
  project_id text primary key references admin.project(id) on delete cascade,
  last_sequence bigint not null default 0 check (last_sequence >= 0)
);

create table workflow.member_event (
  id uuid primary key,
  project_id text not null references admin.project(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  transition_key text not null,
  unit_id text,
  kind text not null check (length(kind) between 1 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, sequence),
  foreign key (transition_key, project_id)
    references workflow.member_transition(transition_key, project_id) on delete cascade
);
create index workflow_member_event_project_idx
  on workflow.member_event (project_id, sequence);

create table workflow.outbox (
  operation_id text primary key check (operation_id ~ '^[0-9a-f]{64}$'),
  transition_key text not null,
  project_id text not null references admin.project(id) on delete cascade,
  queue text not null check (length(queue) between 1 and 100),
  intent_key text not null check (length(intent_key) between 1 and 200),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'leased', 'published')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  published_at timestamptz,
  last_error_code text check (last_error_code is null or length(last_error_code) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transition_key, intent_key),
  foreign key (transition_key, project_id)
    references workflow.member_transition(transition_key, project_id) on delete cascade,
  check ((status = 'leased' and lease_owner is not null and lease_until is not null) or
         (status <> 'leased' and lease_owner is null and lease_until is null)),
  check ((status = 'published') = (published_at is not null))
);
create index workflow_outbox_pending_idx
  on workflow.outbox (next_attempt_at, created_at, operation_id)
  where status = 'pending';
create index workflow_outbox_expired_lease_idx
  on workflow.outbox (lease_until, created_at, operation_id)
  where status = 'leased';
