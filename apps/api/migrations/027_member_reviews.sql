-- Durable, revision-bound member PR reviews. The immutable input manifest contains
-- metadata only; source documents and patches remain in the job's read-only input tree.

create table workflow.member_review (
  review_id text primary key check (review_id ~ '^rev_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  review_key text not null check (review_key ~ '^[a-f0-9]{64}$'),
  generation integer not null check (generation > 0),
  project_id text not null references admin.project(id) on delete cascade,
  unit_id text not null check (unit_id ~ '^[a-z0-9][a-z0-9-]{0,62}/[a-z0-9][a-z0-9-]{0,62}/[a-z0-9][a-z0-9-]{0,62}$'),
  implementation_repository_id text not null,
  server_id text not null,
  provider text not null check (provider in ('github', 'github-enterprise')),
  provider_repository_id text not null check (length(provider_repository_id) between 1 and 200),
  provider_pull_request_id text not null check (length(provider_pull_request_id) between 1 and 200),
  pull_request_number integer not null check (pull_request_number > 0),
  snapshot_id text references delivery.member_snapshot(snapshot_id) on delete set null,
  head_sha text not null check (head_sha ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  base_sha text not null check (base_sha ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  merge_base_sha text not null check (merge_base_sha ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  context_revision text not null check (context_revision ~ '^sha256:[a-f0-9]{64}$'),
  policy_revision text not null check (length(policy_revision) between 1 and 512),
  agent_version text not null check (length(agent_version) between 1 and 512),
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'inconclusive')),
  currentness text not null check (currentness in ('current', 'superseded', 'inconclusive')),
  coverage text check (coverage is null or coverage in ('complete', 'partial')),
  verdict text check (verdict is null or verdict in ('pass', 'fail', 'inconclusive')),
  input_manifest jsonb not null check (jsonb_typeof(input_manifest) = 'object'),
  report jsonb check (report is null or jsonb_typeof(report) = 'object'),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  job_run_id text unique references workflow.job_run(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (review_key, generation),
  unique (server_id, provider_repository_id, provider_pull_request_id, generation),
  foreign key (implementation_repository_id, server_id)
    references admin.git_repository(id, server_id) on delete cascade,
  check ((status in ('queued', 'running')) = (finished_at is null)),
  check (status <> 'running' or started_at is not null),
  check ((status in ('succeeded', 'inconclusive')) = (report is not null)),
  check ((report is not null) = (coverage is not null and verdict is not null)),
  check (status <> 'failed' or failure_code is not null),
  check (status not in ('queued', 'running') or failure_code is null),
  check (coverage <> 'partial' or verdict <> 'pass'),
  check (verdict <> 'pass' or (coverage = 'complete' and currentness = 'current')),
  check (status <> 'succeeded' or verdict in ('pass', 'fail')),
  check (status <> 'inconclusive' or verdict = 'inconclusive')
);

create unique index member_review_one_current_attempt_idx
  on workflow.member_review (server_id, provider_repository_id, provider_pull_request_id)
  where currentness = 'current';

create index member_review_project_unit_idx
  on workflow.member_review (project_id, unit_id, created_at desc);

create index member_review_pull_request_idx
  on workflow.member_review (server_id, provider_repository_id, provider_pull_request_id, generation desc);
