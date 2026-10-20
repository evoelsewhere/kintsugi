-- Coding Agent Workflow credentials and explicit Project Access (ADR-0042).
-- Project role, assignment and RACI data do not create these grants.

create table core.member_token (
  id text primary key,
  user_id text not null references core.app_user(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index core_member_token_user_idx on core.member_token (user_id, created_at desc);

create table core.member_token_project (
  token_id text not null references core.member_token(id) on delete cascade,
  project_id text not null references admin.project(id) on delete cascade,
  primary key (token_id, project_id)
);
create index core_member_token_project_project_idx on core.member_token_project (project_id, token_id);

create table admin.project_access (
  project_id text not null references admin.project(id) on delete cascade,
  user_id text not null references core.app_user(id) on delete cascade,
  granted_by text references core.app_user(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index admin_project_access_user_idx on admin.project_access (user_id, project_id);

insert into core.permission (code, group_name, description) values
  ('member.read', 'Coding Agent Workflow', 'Read authorized project tasks, documents, evidence and reviews'),
  ('tokens.manage-own', 'Coding Agent Workflow', 'Issue, list and revoke personal Coding Agent Workflow tokens'),
  ('project.access.manage', 'Delivery', 'Grant and revoke explicit Project Access')
on conflict (code) do nothing;

-- Basic context access and personal token management are available to primary roles.
-- Project Access grants remain explicit, and grant administration stays with admins.
insert into core.role_permission (role_id, permission_code)
  select id, 'member.read' from core.role where kind = 'primary'
on conflict do nothing;
insert into core.role_permission (role_id, permission_code)
  select id, 'tokens.manage-own' from core.role where kind = 'primary'
on conflict do nothing;
insert into core.role_permission (role_id, permission_code) values ('admin', 'project.access.manage')
on conflict do nothing;
