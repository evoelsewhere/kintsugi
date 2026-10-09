-- Identity & access (ADR-0008, data model: User · Role · Permission · Session).
-- Schema: core (cross-cutting). Permissions are dynamic: development adds codes via
-- migration and they appear in the portal (Roles & Permissions) for granting per role.

create schema if not exists core;

create table core.app_user (
  id text primary key,
  username text not null unique,
  email text not null default '',
  display_name text not null default '',
  password_hash text not null,
  password_salt text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- kind: 'primary' (admin / contribute / user) | 'sub' (dev, ba, tester, … defined by admins)
create table core.role (
  id text primary key,
  kind text not null check (kind in ('primary', 'sub')),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

-- The permission catalog. New permissions = new migration inserting a row here;
-- the portal reads this table, so they show up automatically.
create table core.permission (
  code text primary key,
  group_name text not null,
  description text not null default ''
);

create table core.role_permission (
  role_id text not null references core.role(id) on delete cascade,
  permission_code text not null references core.permission(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table core.user_role (
  user_id text not null references core.app_user(id) on delete cascade,
  role_id text not null references core.role(id) on delete cascade,
  primary key (user_id, role_id)
);

create table core.session (
  token_hash text primary key,
  user_id text not null references core.app_user(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index core_session_user_idx on core.session (user_id);

-- Seed: primary roles and default sub-roles.
insert into core.role (id, kind, name, description) values
  ('admin', 'primary', 'Admin', 'Setup, members, sub-roles, resource policy, telemetry'),
  ('contribute', 'primary', 'Contribute', 'Publish shared agents/skills/MCP, view team monitoring'),
  ('user', 'primary', 'User', 'Consume catalogs, create secrets, report usage'),
  ('dev', 'sub', 'Developer', 'Default sub-role defined by admins'),
  ('ba', 'sub', 'Business analyst', 'Default sub-role defined by admins'),
  ('tester', 'sub', 'Tester', 'Default sub-role defined by admins');

-- Seed: permission catalog (groups mirror the capability areas).
insert into core.permission (code, group_name, description) values
  ('setup.manage', 'Setup', 'Manage installation setup'),
  ('members.manage', 'Members', 'Manage members and their roles'),
  ('roles.manage', 'Roles', 'Manage roles and permission grants'),
  ('subroles.manage', 'Roles', 'Create and manage sub-roles'),
  ('resource-policy.manage', 'Policy', 'Manage resource policy'),
  ('telemetry.view', 'Telemetry', 'View telemetry'),
  ('agents.publish', 'Publish', 'Publish shared agents'),
  ('skills.publish', 'Publish', 'Publish shared skills'),
  ('mcp.publish', 'Publish', 'Publish shared MCP servers'),
  ('monitoring.team.view', 'Monitoring', 'View team monitoring'),
  ('catalog.consume', 'Catalog', 'Consume catalogs'),
  ('secrets.create', 'Secrets', 'Create personal secrets'),
  ('usage.report', 'Usage', 'Report usage'),
  ('providers.manage', 'Setup', 'Manage LLM providers'),
  ('projects.manage', 'Delivery', 'Manage projects and applications'),
  ('workitems.manage', 'Delivery', 'Manage work items');

-- Seed: grants — admin everything, contribute publishing + team monitoring, user consumption.
insert into core.role_permission (role_id, permission_code)
  select 'admin', code from core.permission;
insert into core.role_permission (role_id, permission_code) values
  ('contribute', 'agents.publish'),
  ('contribute', 'skills.publish'),
  ('contribute', 'mcp.publish'),
  ('contribute', 'monitoring.team.view'),
  ('user', 'catalog.consume'),
  ('user', 'secrets.create'),
  ('user', 'usage.report');
