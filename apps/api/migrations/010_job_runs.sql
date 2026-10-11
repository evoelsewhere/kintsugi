-- workflow domain: runtime job runs (ADR-0023, ADR-0027, ADR-0029). The API records a run as
-- `queued` and enqueues it (pg-boss queue `job-run`); the worker prepares the job workspace,
-- runs the step, checks its output with the JobOutput hook and records the outcome here.
--
--   job_run          one step: a script, an agent job, a workflow, or a stage made of steps
--                    (a stage's steps are child runs: parent_id)
--   artifact         index of the files a run produced (paths relative to its output);
--                    the files themselves live in Git once the document write lands (ADR-0007)
--
-- governance domain: restricted records. Files a job writes under `restricted/` in its output
-- (for example the credential inventory of the assess stage) are stored here only, encrypted
-- with KINTSUGI_SECRET_KEY (ADR-0009). They never reach Git, logs or job summaries, and only
-- holders of `restricted.read` can read them.

create schema if not exists workflow;
create schema if not exists governance;

create table workflow.job_run (
  id text primary key,
  project_id text not null references admin.project(id) on delete cascade,
  application_id text,
  parent_id text references workflow.job_run(id) on delete cascade,
  -- 'stage' (a sequence of steps, e.g. assess), 'script', 'agent', 'workflow'
  kind text not null check (kind in ('stage', 'script', 'agent', 'workflow')),
  -- stage id, script file, agent id or workflow id
  name text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  -- redacted: never holds file content, credentials or matched values
  failure_reason text,
  -- the source repository read (read-only, at a fixed commit)
  source_repository_id text,
  source_commit text,
  inputs jsonb not null default '{}'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  -- sha256 of the script that ran (script steps, model-written scripts included)
  script_hash text,
  -- `<agent>@<version>` for agent jobs
  agent text,
  actor text,
  -- counts, sizes, the JobOutput report summary and the agent's usage; never file content
  output_summary jsonb,
  document_write_id text references workflow.document_write(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (project_id, application_id) references admin.application(project_id, id) on delete cascade
);

create index job_run_project on workflow.job_run (project_id, created_at desc);
create index job_run_parent on workflow.job_run (parent_id);

create table workflow.artifact (
  job_run_id text not null references workflow.job_run(id) on delete cascade,
  -- relative to the job's output directory, forward slashes (= the path in the document repo)
  path text not null,
  sha256 text not null,
  size bigint not null,
  -- docs/reference/data-model.md#provenance
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (job_run_id, path)
);

create table governance.restricted_record (
  job_run_id text not null references workflow.job_run(id) on delete cascade,
  -- relative to the job's restricted/ directory
  path text not null,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  size bigint not null,
  created_at timestamptz not null default now(),
  primary key (job_run_id, path)
);

-- Permissions (ADR-0008): new codes are granted to the admin role explicitly.
create schema if not exists core;

insert into core.permission (code, group_name, description) values
  ('jobs.run', 'Delivery', 'Run pipeline stages and runtime jobs'),
  ('restricted.read', 'Governance', 'Read restricted job records (for example credential inventories)')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code) values
  ('admin', 'jobs.run'),
  ('admin', 'restricted.read')
on conflict do nothing;
