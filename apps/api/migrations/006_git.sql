-- admin domain (A3): Git servers and repositories (ADR-0007, ADR-0025). Users register a
-- repository URL and a server credential; Kintsugi clones into its own storage.
-- Credentials are encrypted with KINTSUGI_SECRET_KEY (admin.git_secret) and never
-- returned by the API. SSH host keys are pinned per server (known_hosts lines).

create schema if not exists admin;

create table admin.git_server (
  id text primary key,
  kind text not null check (kind in ('github', 'github-enterprise', 'azure-devops', 'gitlab', 'bitbucket', 'gitea', 'plain-git')),
  name text not null,
  base_url text not null,
  auth_type text not null check (auth_type in ('none', 'token', 'ssh-key')),
  username text,
  known_hosts text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table admin.git_secret (
  secret_id text primary key,
  server_id text not null references admin.git_server(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  created_at timestamptz not null default now()
);

-- A server with repositories cannot be deleted (no cascade): remove the repositories first.
create table admin.git_repository (
  id text primary key,
  server_id text not null references admin.git_server(id),
  url text not null unique,
  default_branch text,
  sync_status text not null default 'pending' check (sync_status in ('pending', 'cloning', 'ready', 'error')),
  last_commit text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into core.permission (code, group_name, description) values
  ('git.manage', 'Setup', 'Manage Git servers and repositories')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code) values
  ('admin', 'git.manage')
on conflict do nothing;
