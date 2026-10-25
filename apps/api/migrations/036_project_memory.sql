-- Derived navigation hints only; formal project knowledge stays in Git (ADR-0076).
create schema if not exists knowledge;
create table knowledge.project_memory_setting (
  project_id text primary key references admin.project(id) on delete cascade,
  enabled boolean not null default false,
  epoch integer not null default 1 check (epoch > 0)
);
create table knowledge.project_memory_entry (
  id text primary key,
  project_id text not null references admin.project(id) on delete cascade,
  application_id text not null,
  epoch integer not null,
  repository_id text not null references admin.git_repository(id) on delete cascade,
  commit_sha text not null,
  path text not null,
  quote text not null check (length(quote) between 12 and 400),
  summary text not null check (length(summary) between 1 and 240),
  source_run_id text not null references workflow.job_run(id) on delete cascade,
  source_step_id text not null references workflow.job_run(id) on delete cascade,
  agent text not null,
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected')),
  reviewed_by text references core.app_user(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (project_id, application_id) references admin.application(project_id, id) on delete cascade
);
create index project_memory_scope on knowledge.project_memory_entry(project_id, epoch, application_id, state);
-- Equivalent evidence may be discovered by several runs: a failed first producer must not
-- hide the same evidence later produced by a successful, accepted run.
create table knowledge.project_memory_origin (
  entry_id text not null references knowledge.project_memory_entry(id) on delete cascade,
  run_id text not null references workflow.job_run(id) on delete cascade,
  step_id text not null references workflow.job_run(id) on delete cascade,
  agent text not null,
  primary key (entry_id, run_id, step_id)
);
-- Rotating the project epoch prevents old in-flight proposals from being collected.
create function knowledge.invalidate_project_memory() returns trigger language plpgsql as $$
begin
  update knowledge.project_memory_setting set epoch = epoch + 1 where project_id = coalesce(new.project_id, old.project_id);
  delete from knowledge.project_memory_entry where project_id = coalesce(new.project_id, old.project_id);
  return coalesce(new, old);
end;
$$;
create trigger project_memory_repository_change after insert or update or delete on admin.project_repository
  for each row execute function knowledge.invalidate_project_memory();

insert into core.permission(code, group_name, description) values
  ('project.memory.manage', 'Administration', 'Enable, inspect, review and reset project memory')
on conflict do nothing;
insert into core.role_permission(role_id, permission_code) values ('admin', 'project.memory.manage') on conflict do nothing;
