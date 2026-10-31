-- A project-scoped model binding (admin.agent_model_binding, 001_llm_providers.sql) names its project in
-- project_id, with '*' for the installation default, so it cannot reference admin.project. Deleting a project
-- left its bindings behind, and a project created again under the same id took over the old project's models.
-- Bindings of projects that are gone are removed once; from now on deleting a project removes its bindings.
-- Schema: admin.

create schema if not exists admin;

delete from admin.agent_model_binding b
 where b.project_id <> '*'
   and not exists (select 1 from admin.project p where p.id = b.project_id);

create function admin.remove_project_model_bindings() returns trigger language plpgsql as $$
begin
  delete from admin.agent_model_binding where project_id = old.id;
  return old;
end;
$$;

create trigger project_model_bindings_delete after delete on admin.project
  for each row execute function admin.remove_project_model_bindings();
