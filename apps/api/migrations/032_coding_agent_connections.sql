-- Project-scoped browser authorization for the local Coding Agent Workflow (ADR-0056).
-- Connection and authorization records contain credential hashes and metadata only.

create table core.member_connection (
  id text primary key,
  user_id text not null references core.app_user(id) on delete cascade,
  client_name text not null check (length(btrim(client_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text references core.app_user(id) on delete set null
);
create index core_member_connection_user_idx on core.member_connection (user_id, created_at desc);

create table core.member_connection_project (
  connection_id text not null references core.member_connection(id) on delete cascade,
  project_id text not null references admin.project(id) on delete cascade,
  primary key (connection_id, project_id)
);
create index core_member_connection_project_project_idx on core.member_connection_project (project_id, connection_id);

create table core.member_authorization_code (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  user_id text not null references core.app_user(id) on delete cascade,
  client_name text not null check (length(btrim(client_name)) between 1 and 80),
  redirect_uri text not null,
  code_challenge text not null check (length(code_challenge) between 43 and 128),
  project_ids text[] not null check (cardinality(project_ids) > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);
create index core_member_authorization_code_expiry_idx on core.member_authorization_code (expires_at);

-- Retain hashes of consumed refresh credentials so replay of any rotated value can revoke
-- its owning connection, even after later rotations.
create table core.member_connection_refresh_token (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  connection_id text not null references core.member_connection(id) on delete cascade,
  issued_at timestamptz not null default now(),
  consumed_at timestamptz
);
create unique index core_member_connection_refresh_active_idx
  on core.member_connection_refresh_token (connection_id) where consumed_at is null;

alter table core.member_token
  add column connection_id text references core.member_connection(id) on delete set null;
create index core_member_token_connection_idx on core.member_token (connection_id) where connection_id is not null;

insert into core.permission (code, group_name, description) values
  ('security.manage', 'Security', 'Manage Coding Agent Workflow connection policy and revoke any member connection')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code)
values ('admin', 'security.manage')
on conflict do nothing;
