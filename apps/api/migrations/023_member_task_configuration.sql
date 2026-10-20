-- Cache identity includes the registered application set as well as immutable Git input.
-- Existing indexes are intentionally invalidated by the empty fingerprint until rebuilt.
alter table delivery.member_task_index
  add column application_ids_fingerprint text not null default ''
    check (application_ids_fingerprint = '' or application_ids_fingerprint ~ '^[0-9a-f]{64}$'),
  add column index_id uuid not null default gen_random_uuid();

-- Deletion cascades remove task rows. Recreating the same ID must rebuild those rows
-- even though the stable sorted-ID fingerprint is unchanged.
create function delivery.invalidate_member_task_configuration() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' or TG_OP = 'UPDATE' then
    delete from delivery.member_task_index where project_id = OLD.project_id;
  end if;
  if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
    delete from delivery.member_task_index where project_id = NEW.project_id;
  end if;
  return null;
end;
$$;
create trigger member_task_application_configuration
  after insert or delete or update of id, project_id on admin.application
  for each row execute function delivery.invalidate_member_task_configuration();
