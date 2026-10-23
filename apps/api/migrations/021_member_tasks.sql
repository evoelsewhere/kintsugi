-- Rebuildable Coding Agent Workflow task projection; Git remains the authoritative source.
create schema if not exists delivery;

create table delivery.member_task_index (
  project_id text primary key references admin.project(id) on delete cascade,
  repository_id text not null references admin.git_repository(id) on delete restrict,
  source_commit text not null check (source_commit ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  task_count integer not null check (task_count >= 0),
  issue_count integer not null check (issue_count >= 0),
  indexed_at timestamptz not null default now()
);

create table delivery.member_task_projection (
  project_id text not null references admin.project(id) on delete cascade,
  application_id text not null,
  unit_id text not null,
  repository_id text not null references admin.git_repository(id) on delete restrict,
  source_commit text not null check (source_commit ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  source_path text not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  assignee text,
  work_item jsonb not null,
  required_inputs jsonb not null,
  source_references jsonb not null,
  predecessor_gates jsonb not null,
  indexed_at timestamptz not null default now(),
  primary key (project_id, unit_id),
  foreign key (project_id, application_id) references admin.application(project_id, id) on delete cascade
);

create index member_task_projection_assignee on delivery.member_task_projection (project_id, assignee);

create table delivery.member_task_index_issue (
  project_id text not null references admin.project(id) on delete cascade,
  source_commit text not null check (source_commit ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  source_path text not null,
  messages jsonb not null,
  indexed_at timestamptz not null default now(),
  primary key (project_id, source_commit, source_path)
);
