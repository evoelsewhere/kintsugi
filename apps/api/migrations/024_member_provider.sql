-- GitHub/GHES credentials and durable Coding Agent Workflow provider observations.
-- Installation private keys remain encrypted in admin.git_secret; observation tables
-- contain normalized facts and untrusted webhook payloads, never credentials.

alter table admin.git_server
  add column github_app_id text,
  add column github_installation_id text,
  add constraint git_server_github_app_config_check check (
    (github_app_id is null and github_installation_id is null)
    or (
      github_app_id is not null
      and github_installation_id is not null
      and
      kind in ('github', 'github-enterprise')
      and github_app_id ~ '^[0-9]+$'
      and github_installation_id ~ '^[0-9]+$'
    )
  );

-- Composite keys prevent observations and task links from pairing a repository
-- with a different Git server or a task projected from another repository.
alter table admin.git_repository
  add constraint git_repository_id_server_id_unique unique (id, server_id);

alter table delivery.member_task_projection
  add constraint member_task_projection_task_repository_unique unique (project_id, unit_id, repository_id);

create table workflow.member_provider_delivery (
  server_id text not null,
  delivery_id text not null check (length(delivery_id) between 1 and 200),
  event_name text not null check (length(event_name) between 1 and 100),
  action text check (action is null or length(action) <= 100),
  repository_id text not null,
  pull_request_number integer check (pull_request_number is null or pull_request_number > 0),
  payload jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check (state in ('pending', 'processing', 'processed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  primary key (server_id, delivery_id),
  foreign key (repository_id, server_id) references admin.git_repository(id, server_id) on delete cascade,
  check ((state = 'processed') = (processed_at is not null))
);

create index member_provider_delivery_pending_idx
  on workflow.member_provider_delivery (received_at, server_id, delivery_id)
  where state in ('pending', 'failed');

create table workflow.member_provider_sync_watermark (
  server_id text not null,
  repository_id text not null,
  provider_repository_id text check (provider_repository_id is null or length(provider_repository_id) <= 200),
  updated_at_watermark timestamptz not null default 'epoch',
  cursor text,
  sweep_started_at timestamptz,
  sweep_completed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (server_id, repository_id),
  foreign key (repository_id, server_id) references admin.git_repository(id, server_id) on delete cascade
);

create table workflow.member_provider_observation (
  server_id text not null,
  repository_id text not null,
  provider_repository_id text not null check (length(provider_repository_id) between 1 and 200),
  provider_pull_request_id text not null check (length(provider_pull_request_id) between 1 and 200),
  pull_request_number integer not null check (pull_request_number > 0),
  state text not null check (state in ('open', 'closed', 'merged')),
  is_draft boolean not null default false,
  author_provider_actor_id text check (author_provider_actor_id is null or length(author_provider_actor_id) between 1 and 200),
  head_sha text not null check (head_sha ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  head_ref text not null,
  base_sha text not null check (base_sha ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  base_ref text not null,
  merge_base_sha text check (merge_base_sha is null or merge_base_sha ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  test_merge_sha text check (test_merge_sha is null or test_merge_sha ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  merge_commit_sha text check (merge_commit_sha is null or merge_commit_sha ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  merged_at timestamptz,
  provider_updated_at timestamptz not null,
  observed_at timestamptz not null default now(),
  reviews jsonb not null default '[]'::jsonb check (jsonb_typeof(reviews) = 'array'),
  checks jsonb not null default '[]'::jsonb check (jsonb_typeof(checks) = 'array'),
  primary key (server_id, provider_repository_id, provider_pull_request_id),
  unique (repository_id, server_id, provider_repository_id, provider_pull_request_id, pull_request_number),
  unique (repository_id, server_id, provider_repository_id, provider_pull_request_id, pull_request_number, author_provider_actor_id),
  foreign key (repository_id, server_id) references admin.git_repository(id, server_id) on delete cascade,
  check ((state = 'merged') = (merged_at is not null)),
  check (state <> 'merged' or test_merge_sha is null)
);

create index member_provider_observation_repository_idx
  on workflow.member_provider_observation (repository_id, provider_updated_at desc);

create table workflow.member_provider_actor_mapping (
  project_id text not null references admin.project(id) on delete cascade,
  server_id text not null references admin.git_server(id) on delete cascade,
  provider_actor_id text not null check (length(provider_actor_id) between 1 and 200),
  user_id text not null,
  confirmed_by text not null references core.app_user(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (project_id, server_id, provider_actor_id),
  foreign key (project_id, user_id) references admin.project_access(project_id, user_id) on delete cascade
);

create table workflow.member_task_pull_request (
  server_id text not null,
  repository_id text not null,
  provider_repository_id text not null check (length(provider_repository_id) between 1 and 200),
  provider_pull_request_id text not null check (length(provider_pull_request_id) between 1 and 200),
  pull_request_number integer not null check (pull_request_number > 0),
  project_id text not null,
  unit_id text not null,
  association_state text not null check (association_state in ('needs_confirmation', 'confirmed', 'rejected')),
  association_source text check (association_source is null or association_source in ('verified_actor', 'maintainer')),
  verified_actor_id text check (verified_actor_id is null or length(verified_actor_id) between 1 and 200),
  context_revision text check (context_revision is null or context_revision ~ '^sha256:[a-f0-9]{64}$'),
  target_branch text,
  deliverable_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(deliverable_ids) = 'array'),
  confirmed_by text references core.app_user(id) on delete restrict,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (server_id, provider_repository_id, provider_pull_request_id),
  foreign key (repository_id, server_id) references admin.git_repository(id, server_id) on delete cascade,
  foreign key (project_id, unit_id, repository_id) references delivery.member_task_projection(project_id, unit_id, repository_id) on delete cascade,
  foreign key (project_id, server_id, verified_actor_id)
    references workflow.member_provider_actor_mapping (project_id, server_id, provider_actor_id) on delete cascade,
  foreign key (repository_id, server_id, provider_repository_id, provider_pull_request_id, pull_request_number)
    references workflow.member_provider_observation (repository_id, server_id, provider_repository_id, provider_pull_request_id, pull_request_number) on delete cascade,
  foreign key (repository_id, server_id, provider_repository_id, provider_pull_request_id, pull_request_number, verified_actor_id)
    references workflow.member_provider_observation (repository_id, server_id, provider_repository_id, provider_pull_request_id, pull_request_number, author_provider_actor_id) on delete cascade,
  check (
    (association_state = 'confirmed' and association_source = 'maintainer' and confirmed_at is not null and confirmed_by is not null and verified_actor_id is null)
    or (association_state = 'confirmed' and association_source = 'verified_actor' and confirmed_at is not null and confirmed_by is null and verified_actor_id is not null)
    or (association_state <> 'confirmed' and association_source is null and confirmed_at is null and confirmed_by is null and verified_actor_id is null)
  )
);

create index member_task_pull_request_task_idx
  on workflow.member_task_pull_request (project_id, unit_id, association_state);
