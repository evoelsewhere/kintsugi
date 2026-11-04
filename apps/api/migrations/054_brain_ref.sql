-- The raw references of the indexed documents and what an incremental build of the Brain needs (ADR-0097 decision 6).
-- `brain_ref` keeps the input of link resolution, one row per reference in a document's list, in the order the build
-- found them (that order decides the cap per node and the de-duplication); the result stays in `brain_link`. A build
-- that rebuilds only the documents that changed reads the others' parts back from `brain_node` and `brain_ref`.
-- Rows an older builder wrote have no references: `refs_complete` is false until the next whole build, which is the
-- build every such index gets first.
create table if not exists knowledge.brain_ref (
  project_id text not null references knowledge.brain_source(project_id) on delete cascade,
  path text not null,
  ordinal integer not null,
  from_id text not null,
  kind text not null check (kind in ('link', 'id')),
  target_path text,
  target_anchor text,
  target_id text,
  primary key (project_id, path, ordinal)
);

-- The references that point at a document or an identifier of a changed document are resolved again.
create index if not exists brain_ref_target_path_idx on knowledge.brain_ref (project_id, target_path) where target_path is not null;
create index if not exists brain_ref_target_id_idx on knowledge.brain_ref (project_id, target_id) where target_id is not null;
create index if not exists brain_ref_from_idx on knowledge.brain_ref (project_id, from_id);

-- A document's key and manual order, a card's alias; null elsewhere.
alter table knowledge.brain_node add column if not exists home jsonb;

alter table knowledge.brain_source
  add column if not exists incremental_builds integer not null default 0 check (incremental_builds >= 0),
  add column if not exists whole_built_at timestamptz,
  add column if not exists last_build text check (last_build in ('whole', 'incremental')),
  add column if not exists refs_complete boolean not null default false;
