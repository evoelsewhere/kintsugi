-- Agent memory is durable operational data: immediate writes, separate reviewed trust (ADR-0078).
drop trigger if exists project_memory_repository_change on admin.project_repository;
drop function if exists knowledge.invalidate_project_memory();
drop table if exists knowledge.project_memory_origin;
alter table knowledge.project_memory_entry
  alter column application_id drop not null,
  alter column repository_id drop not null,
  alter column commit_sha drop not null,
  alter column path drop not null,
  alter column quote drop not null,
  alter column source_run_id drop not null,
  alter column source_step_id drop not null,
  add column kind text not null default 'navigation' check (kind in ('fact','lesson','decision','navigation')),
  add column target text not null default 'long_term' check (target in ('long_term','daily')),
  add column content text,
  add column tags jsonb not null default '[]'::jsonb,
  add column day date,
  add column origin_application_id text,
  add column source_stage text not null default 'understand',
  add column deleted_at timestamptz,
  add column recovery_id text;
update knowledge.project_memory_entry set content = summary || E'\n\n' || coalesce(quote,''), origin_application_id = application_id;
alter table knowledge.project_memory_entry alter column content set not null;
alter table knowledge.project_memory_entry add check (length(content) between 1 and 2000);
alter table knowledge.project_memory_entry add check ((target='daily') = (day is not null));
alter table knowledge.project_memory_entry add check (jsonb_typeof(tags)='array' and jsonb_array_length(tags) <= 8);
alter table knowledge.project_memory_entry drop constraint project_memory_entry_state_check;
update knowledge.project_memory_entry set state = 'learned' where state = 'pending';
alter table knowledge.project_memory_entry alter column state set default 'learned';
alter table knowledge.project_memory_entry add check (state in ('learned','approved','rejected'));
alter table knowledge.project_memory_entry drop constraint project_memory_entry_source_run_id_fkey;
alter table knowledge.project_memory_entry drop constraint project_memory_entry_source_step_id_fkey;
alter table knowledge.project_memory_entry add foreign key (source_run_id) references workflow.job_run(id) on delete set null;
alter table knowledge.project_memory_entry add foreign key (source_step_id) references workflow.job_run(id) on delete set null;
alter table knowledge.project_memory_entry drop constraint project_memory_entry_repository_id_fkey;
alter table knowledge.project_memory_entry add foreign key (repository_id) references admin.git_repository(id) on delete set null;
-- A removed evidence repository must not turn a source-bound entry into an unrestricted general note.
create function knowledge.remove_memory_evidence() returns trigger language plpgsql as $$
begin
  delete from knowledge.project_memory_entry where repository_id = old.id;
  return old;
end;
$$;
create trigger memory_evidence_repository_delete before delete on admin.git_repository
  for each row execute function knowledge.remove_memory_evidence();
create table knowledge.project_memory_recovery (
  id text primary key,
  project_id text not null references admin.project(id) on delete cascade,
  entry_id text not null references knowledge.project_memory_entry(id) on delete cascade,
  epoch integer not null,
  created_by_run_id text references workflow.job_run(id) on delete set null,
  created_at timestamptz not null default now(),
  restored_at timestamptz
);
create table knowledge.project_memory_scratchpad (
  id text primary key,
  project_id text not null references admin.project(id) on delete cascade,
  run_id text not null references workflow.job_run(id) on delete cascade,
  epoch integer not null,
  text text not null check (length(text) between 1 and 1000),
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index memory_scratchpad_run on knowledge.project_memory_scratchpad(project_id, run_id, epoch);
create index memory_target_day on knowledge.project_memory_entry(project_id, epoch, target, day);
create index memory_text on knowledge.project_memory_entry using gin(to_tsvector('simple', summary || ' ' || content || ' ' || tags::text));
