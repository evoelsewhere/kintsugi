-- The four wiki permission codes of ADR-0099 decision 5. Reading the wiki needs no code: Project Access is enough
-- (decision 4). The codes are checked by the wiki module from Phase 2 of the roadmap on; until then administrators can
-- already grant them to access roles, and the admin role holds all four as it holds every code. Schema: core.

insert into core.permission (code, group_name, description) values
  ('wiki.comment', 'Wiki', 'Comment, reply, resolve and reopen; react; edit and delete one''s own comments while they have no replies'),
  ('wiki.write', 'Wiki', 'Create, edit, move, rename, delete and restore pages, add attachments, label and archive, all as drafts published for review'),
  ('wiki.publish', 'Wiki', 'Publish directly on the paths set for direct publication; needs wiki.write too'),
  ('wiki.manage', 'Wiki', 'Create and archive spaces, set and clear edit restrictions, list them, moderate others'' comments')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code) values
  ('admin', 'wiki.comment'),
  ('admin', 'wiki.write'),
  ('admin', 'wiki.publish'),
  ('admin', 'wiki.manage')
on conflict do nothing;
