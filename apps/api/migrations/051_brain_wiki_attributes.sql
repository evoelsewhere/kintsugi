-- Page attributes of the Brain's nodes (ADR-0097 decision 1): the labels, status and owner a page's front matter gives,
-- whether it is a template, and the space its folder is in. A folder takes those of its home page. Builder 6 fills them;
-- an index built by an earlier builder has the defaults until the worker rebuilds it, which it does once because the
-- builder version changed.
alter table knowledge.brain_node
  add column if not exists labels text[] not null default '{}',
  add column if not exists status text,
  add column if not exists owner text,
  add column if not exists template boolean not null default false,
  add column if not exists space text;

-- `label:<name>` and `space:<key>` lookups.
create index if not exists brain_node_labels_idx on knowledge.brain_node using gin (labels);
create index if not exists brain_node_space_idx on knowledge.brain_node (project_id, space) where space is not null;
