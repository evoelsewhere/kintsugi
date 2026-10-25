-- Existing projects must explicitly opt in to direct public page retrieval.
alter table knowledge.web_search_setting add column fetch_enabled boolean not null default false;
alter table knowledge.web_search_request
  add column operation text not null default 'search' check(operation in ('search','fetch')),
  add column lease_until timestamptz,
  add column finished_at timestamptz;
create index web_fetch_project_leases on knowledge.web_search_request(project_id,operation,lease_until) where finished_at is null;
create index web_operation_run_budget on knowledge.web_search_request(project_id,root_id,operation,step_key);

update core.permission set description='Configure project outbound web search, public page retrieval and permitted agents' where code='project.web-search.manage';
