-- admin domain (A1): projects, their applications and the registered Git repositories they
-- use (ADR-0028). Repositories are referenced, never copied: URLs and credentials stay in
-- admin.git_repository / admin.git_server (006_git.sql).
--
-- Rules enforced here (the API checks the same rules first, with clear messages):
--   * the document repo belongs to the project (no application); every other repo to an application;
--   * at most one document repo per project (the API requires exactly one);
--   * a repository is the document repo of at most one project;
--   * a component is set exactly for target repos, and unique among an application's targets;
--   * a repository is linked at most once per project.
-- The API also refuses to link a document repo to any other project, in any role.

create schema if not exists admin;

create table admin.project (
  id text primary key,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table admin.application (
  project_id text not null references admin.project(id) on delete cascade,
  id text not null,
  name text not null,
  disposition text not null check (disposition in ('retire', 'retain', 'rehost', 'replatform', 'refactor', 'rearchitect', 'rebuild', 'repurchase')),
  pipeline text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

-- A linked repository cannot be removed from Settings -> Git (on delete restrict): unlink it first.
create table admin.project_repository (
  project_id text not null references admin.project(id) on delete cascade,
  application_id text,
  repository_id text not null references admin.git_repository(id) on delete restrict,
  role text not null check (role in ('legacy', 'legacy-data', 'document', 'target')),
  component text,
  created_at timestamptz not null default now(),
  primary key (project_id, repository_id),
  foreign key (project_id, application_id) references admin.application(project_id, id) on delete cascade,
  check ((role = 'document') = (application_id is null)),
  check ((role = 'target') = (component is not null))
);

create unique index project_repository_one_document on admin.project_repository (project_id) where role = 'document';
create unique index project_repository_document_owner on admin.project_repository (repository_id) where role = 'document';
create unique index project_repository_target_component on admin.project_repository (project_id, application_id, component) where role = 'target';
create index project_repository_repository on admin.project_repository (repository_id);
