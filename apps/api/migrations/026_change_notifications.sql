-- core domain: change notifications. The API follows what the portal shows over Server-Sent Events
-- instead of the portal asking again and again: a trigger on each table people watch sends one
-- NOTIFY on the `kintsugi_change` channel whenever a row changes, in the transaction that changes it
-- (so it only arrives once the change is visible), whichever process writes (the API or the worker).
--
--   payload   {"t": "<topic>", "s": "<scope>"}: what changed and, where it has one, whose (a project
--             id; a job run id for its events). Never row content: the portal reads the data again.
--
-- Topics: job-runs, job-events, document-writes, repositories, workers, gates, audit, telemetry.

create schema if not exists core;

create or replace function core.notify_change() returns trigger
language plpgsql
as $$
declare
  changed jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  scope text := case when tg_nargs > 1 then coalesce(changed ->> tg_argv[1], '') else '' end;
begin
  perform pg_notify('kintsugi_change', json_build_object('t', tg_argv[0], 's', scope)::text);
  return null;
end;
$$;

create trigger job_run_change after insert or update or delete on workflow.job_run
  for each row execute function core.notify_change('job-runs', 'project_id');

create trigger job_event_change after insert on workflow.job_event
  for each row execute function core.notify_change('job-events', 'job_run_id');

create trigger document_write_change after insert or update or delete on workflow.document_write
  for each row execute function core.notify_change('document-writes', 'project_id');

create trigger git_repository_change after insert or update or delete on admin.git_repository
  for each row execute function core.notify_change('repositories');

create trigger worker_heartbeat_change after insert or update or delete on workflow.worker_heartbeat
  for each row execute function core.notify_change('workers');

create trigger gate_change after insert or update or delete on governance.gate
  for each row execute function core.notify_change('gates', 'project_id');

create trigger audit_event_change after insert on governance.audit_event
  for each row execute function core.notify_change('audit');

create trigger telemetry_span_change after insert on monitoring.telemetry_span
  for each row execute function core.notify_change('telemetry', 'project_id');
