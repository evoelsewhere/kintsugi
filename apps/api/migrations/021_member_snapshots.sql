-- Immutable member context manifests and source indexes; file contents remain in Git.
create schema if not exists delivery;

create table delivery.member_snapshot (
  snapshot_id text primary key check (snapshot_id ~ '^ctx_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  project_id text not null references admin.project(id) on delete cascade,
  unit_id text not null check (unit_id ~ '^[a-z0-9][a-z0-9-]{0,62}/[a-z0-9][a-z0-9-]{0,62}/[a-z0-9][a-z0-9-]{0,62}$'),
  activity text not null check (activity in ('design', 'implementation', 'verification')),
  requested_by_user_id text not null,
  context_revision text not null check (context_revision ~ '^sha256:[a-f0-9]{64}$'),
  task jsonb not null,
  readiness jsonb not null,
  manifest jsonb not null,
  status text not null default 'preparing' check (status in ('preparing', 'ready', 'failed', 'expiring', 'expired')),
  pin_state text not null default 'pending' check (pin_state in ('pending', 'retained', 'failed', 'releasing', 'released')),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z0-9_]{1,100}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ready_at timestamptz,
  expired_at timestamptz,
  retention_checked_at timestamptz,
  check (expires_at > created_at),
  check ((status = 'ready') = (ready_at is not null)),
  check ((status = 'expired') = (expired_at is not null)),
  check ((status = 'failed') = (failure_code is not null)),
  check ((pin_state = 'retained') = (status = 'ready')),
  check ((pin_state = 'releasing') = (status = 'expiring'))
);

create index member_snapshot_project_task_idx
  on delivery.member_snapshot (project_id, unit_id, created_at desc);
create index member_snapshot_expiry_idx
  on delivery.member_snapshot (expires_at, snapshot_id)
  where status in ('ready', 'expiring');

create table delivery.member_snapshot_source (
  snapshot_id text not null references delivery.member_snapshot(snapshot_id) on delete cascade,
  source_id text not null check (length(source_id) between 1 and 512),
  role text not null check (length(role) between 1 and 100),
  repository_id text not null references admin.git_repository(id) on delete restrict,
  source_commit text check (source_commit is null or source_commit ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  source_path text not null check (length(source_path) between 1 and 1000),
  content_hash text check (content_hash is null or content_hash ~ '^sha256:[a-f0-9]{64}$'),
  availability text not null check (availability in ('present', 'missing')),
  publication text not null check (publication in ('draft', 'published', 'unknown')),
  approval text not null check (approval in ('approved', 'pending', 'rejected', 'unknown', 'not-required')),
  required_for jsonb not null,
  is_required boolean not null,
  readable boolean not null,
  sections jsonb not null,
  primary key (snapshot_id, source_id),
  check ((availability = 'present') = (source_commit is not null and content_hash is not null))
);

create index member_snapshot_source_repo_commit_idx
  on delivery.member_snapshot_source (snapshot_id, repository_id, source_commit)
  where source_commit is not null;

create table delivery.member_snapshot_cursor (
  cursor_id uuid primary key,
  snapshot_id text not null references delivery.member_snapshot(snapshot_id) on delete cascade,
  cursor_kind text not null check (cursor_kind in ('document', 'search')),
  source_id text,
  section_id text,
  character_offset integer check (character_offset is null or character_offset >= 0),
  query_hash text check (query_hash is null or query_hash ~ '^[a-f0-9]{64}$'),
  result_offset integer check (result_offset is null or result_offset >= 0),
  created_at timestamptz not null default now(),
  check (
    (cursor_kind = 'document' and source_id is not null and section_id is not null and character_offset is not null and query_hash is null and result_offset is null)
    or
    (cursor_kind = 'search' and source_id is null and section_id is null and character_offset is null and query_hash is not null and result_offset is not null)
  )
);

create index member_snapshot_cursor_snapshot_idx
  on delivery.member_snapshot_cursor (snapshot_id, created_at);

create table delivery.member_snapshot_lease (
  lease_id uuid primary key,
  snapshot_id text not null references delivery.member_snapshot(snapshot_id) on delete cascade,
  purpose text not null check (length(purpose) between 1 and 100),
  owner_id text not null check (length(owner_id) between 1 and 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (snapshot_id, purpose, owner_id)
);

create index member_snapshot_lease_active_idx
  on delivery.member_snapshot_lease (snapshot_id, expires_at);

create function delivery.prevent_member_snapshot_manifest_update() returns trigger
language plpgsql as $$
begin
  if new.snapshot_id is distinct from old.snapshot_id
     or new.project_id is distinct from old.project_id
     or new.unit_id is distinct from old.unit_id
     or new.activity is distinct from old.activity
     or new.requested_by_user_id is distinct from old.requested_by_user_id
     or new.context_revision is distinct from old.context_revision
     or new.task is distinct from old.task
     or new.readiness is distinct from old.readiness
     or new.manifest is distinct from old.manifest
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'member snapshot identity and manifest are immutable';
  end if;
  return new;
end;
$$;

create trigger member_snapshot_manifest_immutable
  before update on delivery.member_snapshot
  for each row execute function delivery.prevent_member_snapshot_manifest_update();

create function delivery.prevent_member_snapshot_source_update() returns trigger
language plpgsql as $$
begin
  raise exception 'member snapshot source indexes are immutable';
end;
$$;

create trigger member_snapshot_source_immutable
  before update on delivery.member_snapshot_source
  for each row execute function delivery.prevent_member_snapshot_source_update();
