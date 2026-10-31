-- The Brain (ADR-0091): a vectorless, reasoning-based index of one branch of a project's document repository.
-- The tree (folders, documents, sections, cards) with a summary per node and the links between nodes; the text
-- itself stays in Git and is read by line range from the mirror. One index per project, replaced whole when the
-- branch moves. The worker writes it; the API and the member bridge read it.
create schema if not exists knowledge;

create table knowledge.brain_source (
  project_id text primary key references admin.project(id) on delete cascade,
  branch text not null check (length(branch) between 1 and 255),
  enabled boolean not null default true,
  state text not null default 'queued' check (state in ('queued', 'indexing', 'ready', 'failed')),
  -- The commit the current tree was built from (null until the first build), and the one the last build tried:
  -- a build that failed on a commit is not tried again until the branch moves or someone asks.
  indexed_commit text,
  attempted_commit text,
  indexed_at timestamptz,
  builder_version integer,
  documents integer not null default 0,
  nodes integer not null default 0,
  identifiers integer not null default 0,
  links integer not null default 0,
  tokens bigint not null default 0,
  skipped integer not null default 0,
  duration_ms integer,
  error text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table knowledge.brain_node (
  project_id text not null references knowledge.brain_source(project_id) on delete cascade,
  id text not null,
  parent_id text,
  kind text not null check (kind in ('root', 'folder', 'document', 'section', 'card')),
  path text not null,
  anchor text,
  title text not null,
  summary text not null,
  summary_source text not null,
  ordinal integer not null,
  depth integer not null,
  line_start integer,
  line_end integer,
  subtree_end integer,
  tokens integer not null,
  subtree_tokens bigint not null,
  children integer not null,
  ids text[] not null default '{}',
  primary key (project_id, id)
);
create index brain_node_children on knowledge.brain_node(project_id, parent_id, ordinal);
create index brain_node_path on knowledge.brain_node(project_id, path, line_start);
create index brain_node_ids on knowledge.brain_node using gin(ids);

create table knowledge.brain_link (
  project_id text not null references knowledge.brain_source(project_id) on delete cascade,
  from_id text not null,
  to_id text not null,
  kind text not null check (kind in ('link', 'id')),
  primary key (project_id, from_id, to_id)
);
create index brain_link_to on knowledge.brain_link(project_id, to_id);

-- The portal follows the index state of a project (migration 026).
create trigger brain_source_change after insert or update or delete on knowledge.brain_source
  for each row execute function core.notify_change('brain', 'project_id');

insert into core.permission(code, group_name, description) values
  ('project.brain.manage', 'Administration', 'Choose the branch the Brain indexes, rebuild and turn off its index')
on conflict (code) do nothing;
insert into core.role_permission(role_id, permission_code) values ('admin', 'project.brain.manage') on conflict do nothing;
