-- Job run follow-ups (ADR-0029), the audit log and installation settings.
--
-- workflow domain
--   job_run.cancel_requested_*  a person asked to cancel a running run; the worker that runs
--                               it kills its processes and records the run as `cancelled`
--   job_event                   what happened during a run, for the live view in the portal:
--                               status changes, steps started and finished, agent tool calls
--                               (tool and path only), log lines. Redacted by the worker; never
--                               file content, credentials or matched values.
--
-- governance domain
--   audit_event                 append-only audit log (who, when, what, on which subject).
--                               First entries: every read of a restricted record. Never holds
--                               the content that was read.
--
-- admin domain
--   installation_setting        installation-wide settings managed in the portal (key → JSON),
--                               e.g. `commit-identity`: name and email of kintsugi-bot's commits.

create schema if not exists workflow;
create schema if not exists governance;
create schema if not exists admin;
create schema if not exists core;

alter table workflow.job_run
  add column cancel_requested_at timestamptz,
  add column cancel_requested_by text;

create table workflow.job_event (
  id bigserial primary key,
  -- the top-level run the event belongs to (the stream a person follows)
  job_run_id text not null references workflow.job_run(id) on delete cascade,
  -- the step (child run) it came from; null for the run itself
  step_run_id text references workflow.job_run(id) on delete cascade,
  kind text not null check (kind in ('status', 'step.started', 'step.finished', 'tool', 'log')),
  -- one redacted line
  message text not null,
  -- small structured detail (status, step kind and name, tool name, decision); never content
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index job_event_run on workflow.job_event (job_run_id, id);

create table governance.audit_event (
  id bigserial primary key,
  at timestamptz not null default now(),
  -- user id (or sign-in name) of who acted
  actor text not null,
  -- e.g. 'restricted.read'
  action text not null,
  project_id text,
  -- what was acted on, e.g. the job run id
  subject text,
  -- small detail, e.g. {"path": "SECRETS.local.md"}; never content
  detail jsonb not null default '{}'::jsonb
);

create index audit_event_at on governance.audit_event (at desc, id desc);
create index audit_event_subject on governance.audit_event (subject);

create function governance.audit_event_append_only() returns trigger
  language plpgsql as $$
begin
  raise exception 'governance.audit_event is append-only';
end;
$$;

create trigger audit_event_no_update before update or delete on governance.audit_event
  for each row execute function governance.audit_event_append_only();
create trigger audit_event_no_truncate before truncate on governance.audit_event
  for each statement execute function governance.audit_event_append_only();

create table admin.installation_setting (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Permissions (ADR-0008): new codes are granted to the admin role explicitly.
insert into core.permission (code, group_name, description) values
  ('audit.read', 'Governance', 'Read the audit log')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code) values
  ('admin', 'audit.read')
on conflict do nothing;
