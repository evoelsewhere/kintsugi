-- governance domain: persisted quality gates (docs/methodology/delivery-pipeline.md, G0–G6)
-- and stage gates. A gate is requested (by a person, or by the worker when a stage plan reaches
-- a gate) and stays `pending` until a holder of `gates.decide` approves, rejects or waives it,
-- with a note. A decision is final: asking again creates a new gate row, so the rows of one
-- key are its history. Every request and decision is also recorded in governance.audit_event.
--
--   gate   one request for a decision: project, optional application, gate key (G0–G6 or a
--          stage gate key such as `stage:assess`), what it is about (subject, e.g. a job run
--          id), who asked and when, who decided, when and why
--
-- core domain: the `gates.request` and `gates.decide` permissions. Reading gates needs a
-- session only.

create schema if not exists governance;
create schema if not exists core;

create table governance.gate (
  id text primary key,
  project_id text not null references admin.project(id) on delete cascade,
  application_id text,
  gate_key text not null check (gate_key ~ '^(G[0-6]|[a-z0-9][a-z0-9:._-]{0,99})$'),
  title text not null check (length(title) between 1 and 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'waived')),
  -- what the gate is about, e.g. the job run that reached it
  subject text,
  -- small context for the decider (stage, step, links); never content or credentials
  detail jsonb not null default '{}'::jsonb,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  note text check (note is null or length(note) <= 4000),
  check ((status = 'pending') = (decided_at is null)),
  check (status = 'pending' or decided_by is not null)
);

-- At most one pending gate per project, application, key and subject: asking twice returns
-- the open request (the worker relies on it to request idempotently).
create unique index gate_one_pending on governance.gate (project_id, coalesce(application_id, ''), gate_key, coalesce(subject, ''))
  where status = 'pending';
create index gate_status_requested on governance.gate (status, requested_at desc);
create index gate_project_key on governance.gate (project_id, gate_key, requested_at desc);

insert into core.permission (code, group_name, description) values
  ('gates.request', 'Delivery', 'Request a decision on a quality or stage gate'),
  ('gates.decide', 'Governance', 'Approve, reject or waive quality and stage gates')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code) values
  ('admin', 'gates.request'),
  ('admin', 'gates.decide')
on conflict do nothing;
