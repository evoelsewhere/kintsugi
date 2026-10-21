-- Durable Coding Agent Workflow PR association claims and FK corrections.
-- Parsed Kintsugi task metadata is an untrusted claim carried by a provider PR body.
-- Persist only the validated identifiers, never the body text itself.

-- Task projections are mutable indexes rebuilt wholesale from Git. A foreign key to
-- them would erase PR history during an ordinary refresh. Keep the durable project
-- reference, store the unit identity as evidence, and validate against a retained
-- snapshot whenever creating a new association.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname from pg_constraint
     where conrelid = 'workflow.member_task_pull_request'::regclass and contype = 'f'
       and position('FOREIGN KEY (project_id, unit_id, repository_id)' in pg_get_constraintdef(oid)) > 0
  loop
    execute format('alter table workflow.member_task_pull_request drop constraint %I', constraint_row.conname);
  end loop;

  -- A verified actor association is historical evidence. Revoking Project Access
  -- removes the current actor mapping, but must not erase an accepted PR link.
  for constraint_row in
    select conname from pg_constraint
     where conrelid = 'workflow.member_task_pull_request'::regclass and contype = 'f'
       and position('FOREIGN KEY (project_id, server_id, verified_actor_id)' in pg_get_constraintdef(oid)) > 0
  loop
    execute format('alter table workflow.member_task_pull_request drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

alter table workflow.member_task_pull_request
  add constraint member_task_pull_request_project_fkey
    foreign key (project_id)
    references admin.project(id) on delete cascade;

alter table workflow.member_provider_observation
  add column association_claim_status text not null default 'absent'
    check (association_claim_status in ('absent', 'invalid', 'valid')),
  add column association_claim jsonb,
  add constraint member_provider_observation_claim_state_check check (
    (association_claim_status = 'valid'
      and jsonb_typeof(association_claim) = 'object'
      and association_claim ?& array['projectId', 'unitId', 'contextRevision', 'deliverableIds']
      and association_claim - 'projectId' - 'unitId' - 'contextRevision' - 'deliverableIds' = '{}'::jsonb
      and octet_length(association_claim::text) <= 8192)
    or (association_claim_status in ('absent', 'invalid') and association_claim is null)
  );
