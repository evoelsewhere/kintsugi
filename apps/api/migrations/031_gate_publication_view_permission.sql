-- Gate-publication reads are distinct from making or deciding a gate. The API still
-- requires explicit Project Access for the requested project.
create schema if not exists core;

insert into core.permission (code, group_name, description) values
  ('gates.view', 'Governance', 'View project-scoped gate publication and effective status')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code)
  select id, 'gates.view' from core.role where kind = 'primary'
on conflict do nothing;