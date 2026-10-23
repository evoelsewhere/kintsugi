-- Durable procedural choices made by a person while a workflow stage is waiting.
-- These records are separate from governance.gate: a procedural choice never proves delivery quality.

create schema if not exists workflow;

create table workflow.stage_decision (
  job_run_id text not null references workflow.job_run(id) on delete cascade,
  stage_id text not null check (length(stage_id) between 1 and 200),
  gate_id text not null check (length(gate_id) between 1 and 200),
  decision_mode text not null check (decision_mode in ('required-human', 'default')),
  allowed_options jsonb not null check (
    jsonb_typeof(allowed_options) = 'array'
    and jsonb_array_length(allowed_options) between 1 and 64
  ),
  selected_choice text,
  decided_by text references core.app_user(id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (job_run_id, stage_id, gate_id),
  check (selected_choice is null or allowed_options ? selected_choice),
  check (
    (decision_mode = 'required-human' and (
      (selected_choice is null and decided_by is null and decided_at is null)
      or (selected_choice is not null and decided_by is not null and decided_at is not null)
    ))
    or (decision_mode = 'default' and selected_choice is not null and decided_by is null and decided_at is not null)
  )
);

create index stage_decision_pending_idx
  on workflow.stage_decision (created_at, job_run_id)
  where decision_mode = 'required-human' and selected_choice is null;

create function workflow.guard_stage_decision_immutable() returns trigger
language plpgsql as $$
begin
  if new.job_run_id is distinct from old.job_run_id
    or new.stage_id is distinct from old.stage_id
    or new.gate_id is distinct from old.gate_id
    or new.decision_mode is distinct from old.decision_mode
    or new.allowed_options is distinct from old.allowed_options
    or new.created_at is distinct from old.created_at then
    raise exception 'stage decision identity and options are immutable';
  end if;
  if old.selected_choice is not null and (
    new.selected_choice is distinct from old.selected_choice
    or new.decided_by is distinct from old.decided_by
    or new.decided_at is distinct from old.decided_at
  ) then
    raise exception 'a recorded stage decision is immutable';
  end if;
  return new;
end;
$$;

create trigger stage_decision_immutable
  before update on workflow.stage_decision
  for each row execute function workflow.guard_stage_decision_immutable();
