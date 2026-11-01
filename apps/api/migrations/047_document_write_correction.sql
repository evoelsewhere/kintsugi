-- A gap answer is a correction of one specification (ADR-0094): the write records which document and gap it answers,
-- so the Gaps view can show an answer already proposed, and a second answer on the same specification is refused
-- while the first is open (queued, committed or pr-opened) instead of opening a pull request that conflicts with it.
-- Schema: workflow.

create schema if not exists workflow;

alter table workflow.document_write add column if not exists correction jsonb;

create index if not exists document_write_correction
    on workflow.document_write (project_id, (correction->>'path'))
 where correction is not null;
