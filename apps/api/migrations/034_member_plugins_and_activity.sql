-- Plugins for member harnesses (ADR-0069): which member plugins a project offers to whom, and what the
-- members' connections did with them.
--
--   admin.plugin_access        a grant to use one member plugin in one project. `user_id` is a user, or '*'
--                              for every member with explicit Project Access to the project.
--   monitoring.member_activity one thing a member's connection did: a plugin download, a document read, or
--                              something a plugin recorded through the member API. It carries names, counts and
--                              a short summary, never document content. Rows are pruned by the worker after
--                              KINTSUGI_TELEMETRY_RETENTION_DAYS (default 30).

create schema if not exists admin;
create schema if not exists monitoring;

create table admin.plugin_access (
  project_id text not null references admin.project(id) on delete cascade,
  plugin_name text not null,
  user_id text not null,
  granted_by text references core.app_user(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (project_id, plugin_name, user_id),
  check (user_id = '*' or length(user_id) > 0)
);
create index admin_plugin_access_user_idx on admin.plugin_access (user_id, project_id);

create table monitoring.member_activity (
  id text primary key,
  at timestamptz not null default now(),
  user_id text not null references core.app_user(id) on delete cascade,
  project_id text not null references admin.project(id) on delete cascade,
  plugin_name text,
  harness text,
  -- plugin.download, document.read, or a kind a plugin records (result, note, run, ...)
  kind text not null,
  summary text not null default '',
  detail jsonb not null default '{}'::jsonb
);
create index monitoring_member_activity_project_idx on monitoring.member_activity (project_id, at desc);
create index monitoring_member_activity_user_idx on monitoring.member_activity (user_id, at desc);
create index monitoring_member_activity_plugin_idx on monitoring.member_activity (plugin_name, at desc);

insert into core.permission (code, group_name, description) values
  ('plugin.access.manage', 'Delivery', 'Grant and revoke the use of member plugins in a project'),
  ('member.activity.view', 'Telemetry', 'View what members'' connections did in a project')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code) values
  ('admin', 'plugin.access.manage'),
  ('admin', 'member.activity.view')
on conflict do nothing;
