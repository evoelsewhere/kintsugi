-- admin domain: the MCP servers the Kintsugi Runtime may give to agents (ADR-0047). An administrator
-- registers an HTTP endpoint under an id (`tracker`); an agent opts in by naming it in its tools
-- (`mcp__tracker__*`). Only the tools the server marks read-only, or `allowed_tools` names, run in a
-- job. Header values (credentials) are stored encrypted with KINTSUGI_SECRET_KEY (ADR-0009), referenced
-- from `headers` as { secretId }, and never returned by the API.
--
--   mcp_server   one registered server: id, URL, description, enabled flag, request timeout,
--                tool-name patterns allowed besides the read-only ones, header → secret references
--   mcp_secret   the encrypted header values, one row per header
--
-- core domain: the `mcp.manage` permission (every route of the module).

create schema if not exists admin;
create schema if not exists core;

create table admin.mcp_server (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{0,40}$'),
  url text not null check (url ~ '^https?://[^[:space:]]+$' and length(url) <= 2000),
  description text check (description is null or length(description) <= 500),
  enabled boolean not null default true,
  timeout_sec integer not null default 60 check (timeout_sec between 1 and 300),
  allowed_tools text[] not null default '{}',
  headers jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create table admin.mcp_secret (
  secret_id text primary key,
  server_id text not null references admin.mcp_server(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  created_at timestamptz not null default now()
);

insert into core.permission (code, group_name, description) values
  ('mcp.manage', 'Settings', 'Register, change and remove the MCP servers agents may use')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code) values
  ('admin', 'mcp.manage')
on conflict do nothing;
