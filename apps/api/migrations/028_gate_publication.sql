-- Evidence-bound human gate decisions are published by the document writer and become
-- effective only after the record PR merges and the worker validates provider evidence.
create schema if not exists workflow;

create table workflow.gate_publication (
  decision_id text primary key check (decision_id ~ '^gate_[a-f0-9]{48}$'),
  project_id text not null references admin.project(id) on delete cascade,
  unit_id text not null check (unit_id ~ '^[a-z0-9][a-z0-9-]{0,62}/[a-z0-9][a-z0-9-]{0,62}/[a-z0-9][a-z0-9-]{0,62}$'),
  gate_id text not null check (gate_id ~ '^(G[0-6]|stage:[a-z][a-z0-9-]{0,62})$'),
  decision text not null check (decision in ('approved', 'rejected', 'waived')),
  state text not null default 'pending-publication'
    check (state in ('pending-publication', 'awaiting-merge', 'effective', 'stale', 'failed', 'rejected')),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 65536),
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  document_repository_id text not null references admin.git_repository(id) on delete restrict,
  record_path text not null check (length(record_path) between 1 and 1000),
  document_write_id text not null unique references workflow.document_write(id) on delete restrict,
  record_commit text check (record_commit is null or record_commit ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  pr_url text check (pr_url is null or length(pr_url) <= 2048),
  created_by text not null references core.app_user(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, unit_id, gate_id, evidence_hash)
);

create index gate_publication_unit_history_idx
  on workflow.gate_publication (project_id, unit_id, gate_id, created_at desc);

create index gate_publication_pending_idx
  on workflow.gate_publication (updated_at, decision_id)
  where state in ('pending-publication', 'awaiting-merge');

create function workflow.guard_gate_publication_evidence_immutable() returns trigger
language plpgsql as $$
begin
  if new.decision_id is distinct from old.decision_id
    or new.project_id is distinct from old.project_id
    or new.unit_id is distinct from old.unit_id
    or new.gate_id is distinct from old.gate_id
    or new.decision is distinct from old.decision
    or new.evidence is distinct from old.evidence
    or new.evidence_hash is distinct from old.evidence_hash
    or new.document_repository_id is distinct from old.document_repository_id
    or new.record_path is distinct from old.record_path
    or new.document_write_id is distinct from old.document_write_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'gate publication evidence is immutable';
  end if;
  return new;
end;
$$;

create trigger gate_publication_evidence_immutable
  before update on workflow.gate_publication
  for each row execute function workflow.guard_gate_publication_evidence_immutable();
