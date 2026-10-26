-- A portal answer proposes a correction to the existing specification; a Git review/merge accepts it.
insert into core.permission (code, group_name, description) values
  ('documents.resolve', 'Delivery', 'Propose answers and reopen gaps in original specifications')
on conflict (code) do nothing;
insert into core.role_permission (role_id, permission_code) values ('admin', 'documents.resolve')
on conflict do nothing;
