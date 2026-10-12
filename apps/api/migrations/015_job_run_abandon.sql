-- workflow domain: abandoned runs (ADR-0033). A person abandons an understand run whose pull
-- request was closed without merging: its items are released (no longer `in-pr`) and can be
-- selected again. The run itself is kept as it was.

alter table workflow.job_run add column if not exists abandoned_at timestamptz;
alter table workflow.job_run add column if not exists abandoned_by text;

create index if not exists job_run_app_stage_idx on workflow.job_run (project_id, application_id, name, created_at desc) where parent_id is null;
