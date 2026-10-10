-- Permission for governance writes (policies, reviews, risks, rulebook entries).
-- Schema: core. New permission codes must be granted to the admin role explicitly:
-- the 002 seed grant only covered the codes that existed at the time.

create schema if not exists core;

insert into core.permission (code, group_name, description) values
  ('governance.manage', 'Governance', 'Manage policies, reviews, risks and rulebook entries')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code) values
  ('admin', 'governance.manage')
on conflict do nothing;
