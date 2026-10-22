-- monitoring domain: the debug MCP server of a development installation (ADR-0056).
--
--   debug_log     the lines the API and the worker print, one row each, mirrored here only when
--                 KINTSUGI_DEBUG_MCP=1 (redacted of credentials, one day and 200 000 lines at most,
--                 pruned by the writers). The debug MCP server reads it; nothing else does.
--
-- core domain: the `debug.access` permission, held by the admin role only, which the server requires of
-- the account that signs in to it.

create schema if not exists monitoring;

create table monitoring.debug_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  -- `api` or `worker`
  service text not null,
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  message text not null
);

create index debug_log_service_id on monitoring.debug_log (service, id);
create index debug_log_at on monitoring.debug_log (at);

insert into core.permission (code, group_name, description) values
  ('debug.access', 'Settings', 'Sign in to the debug MCP server of a development installation')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code) values
  ('admin', 'debug.access')
on conflict do nothing;
