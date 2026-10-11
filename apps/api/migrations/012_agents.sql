-- admin domain: custom agents and shared skills of the Agent Builder (ADR-0026, ADR-0027).
-- Built-in agents and skills ship in packages/agents/builtin and are never stored here;
-- their names are reserved (the API refuses them). A custom agent is stored as its package
-- files, the same format as import and export: `<name>.md` plus `skills/<n>/SKILL.md`.
--
--   agent           the current version of each custom agent (runtime or member audience)
--   agent_version   every saved version, immutable; restoring one makes it current again
--   agent_skill     shared skills referenced by name from an agent's `skills:` list
--
-- core domain: the `agents.manage` permission (create, edit, copy, import, enable, delete).
-- Reading the catalog needs a session only.

create schema if not exists admin;
create schema if not exists core;

create table admin.agent (
  name text primary key,
  audience text not null check (audience in ('runtime', 'member')),
  version text not null,
  -- relative POSIX path → file content
  package jsonb not null,
  enabled boolean not null default true,
  -- `<built-in>@<version>` when copied from a built-in agent
  copied_from text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create table admin.agent_version (
  name text not null references admin.agent(name) on delete cascade,
  version text not null,
  package jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (name, version)
);

create table admin.agent_skill (
  name text primary key,
  -- the SKILL.md text (Agent Skills format)
  content text not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

insert into core.permission (code, group_name, description) values
  ('agents.manage', 'Setup', 'Manage runtime and member agents and shared skills in the Agent Builder')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code) values
  ('admin', 'agents.manage')
on conflict do nothing;
