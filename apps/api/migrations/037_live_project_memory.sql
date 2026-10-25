-- Remove the pre-tool pilot's snapshots if migration 036 was applied before the live-memory refactor.
drop table if exists knowledge.project_memory_snapshot;

create or replace function knowledge.invalidate_project_memory() returns trigger language plpgsql as $$
begin
  update knowledge.project_memory_setting set epoch = epoch + 1 where project_id = coalesce(new.project_id, old.project_id);
  delete from knowledge.project_memory_entry where project_id = coalesce(new.project_id, old.project_id);
  return coalesce(new, old);
end;
$$;
