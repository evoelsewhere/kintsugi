create schema if not exists knowledge;
create table knowledge.web_search_setting (
  project_id text primary key references admin.project(id) on delete cascade,
  enabled boolean not null default false,
  epoch integer not null default 1 check(epoch > 0),
  agents text[] not null default array['designer']::text[],
  active_request text,
  active_until timestamptz,
  next_search_at timestamptz
);
-- Reservations persist across worker restarts and run retries. Query text is never stored here.
create table knowledge.web_search_request (
  id text primary key,
  project_id text not null references admin.project(id) on delete cascade,
  root_id text not null references workflow.job_run(id) on delete cascade,
  step_id text not null references workflow.job_run(id) on delete cascade,
  step_key text not null,
  created_at timestamptz not null default now()
);
create index web_search_run_budget on knowledge.web_search_request(project_id, root_id, step_key);
insert into core.permission(code, group_name, description) values
  ('project.web-search.manage', 'Administration', 'Configure project outbound web search and permitted agents')
on conflict do nothing;
insert into core.role_permission(role_id, permission_code) values ('admin', 'project.web-search.manage') on conflict do nothing;
