-- workflow domain: writes to a project's document repo (ADR-0019). The API records a write
-- as `queued` and enqueues it (pg-boss queue `document-write`); the worker (the only
-- component that commits to project repos) records the outcome on the same row.
--
-- Schema `workflow`, not `admin`: these are records of work the worker performs (like the
-- coming job runs and stage transitions), not installation or project configuration.
--
-- A write can touch auto-commit paths (committed on the default branch: commit_sha) and
-- other paths (pushed to a kintsugi/* branch: branch, branch_commit_sha, and proposed as a
-- pull request: pr_url). `error` is redacted by the worker; it never holds a credential.

create schema if not exists workflow;

create table workflow.document_write (
  id text primary key,
  project_id text not null references admin.project(id) on delete cascade,
  -- what produced the files: 'manifest' (kintsugi.yaml publish), 'job-output', 'state-change'
  kind text not null,
  status text not null default 'queued' check (status in ('queued', 'committed', 'pr-opened', 'unchanged', 'failed')),
  message text not null,
  branch text,
  commit_sha text,
  branch_commit_sha text,
  pr_url text,
  error text,
  -- provenance, as in the commit trailers (Kintsugi-Actor, Kintsugi-Job, Kintsugi-Agent)
  actor text,
  job_id text,
  agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index document_write_project on workflow.document_write (project_id, created_at desc);
