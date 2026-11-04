-- What editing a wiki needs to keep (ADR-0096 decision 7, ADR-0098 decision 2, ADR-0099 decision 5): the counters of
-- page ids, a person's draft of a page and the files attached to it, and the edit restrictions of a project. Git stays
-- the source of truth for published documents; these rows are working state and go with the project.

-- The next number of a page id (PAGE-<KEY>-NNNN) per project and scope.
create table if not exists knowledge.wiki_id_counter (
  project_id text not null references admin.project(id) on delete cascade,
  scope text not null check (scope <> ''),
  next integer not null default 1 check (next >= 1),
  primary key (project_id, scope)
);

-- One person's unpublished text of one page. `write_id` is the document write that published it, kept until that
-- write is merged or committed; `base_commit` and `base_hash` are what the text was read from (null for a new page).
create table if not exists knowledge.wiki_draft (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references admin.project(id) on delete cascade,
  user_id text not null references core.app_user(id) on delete cascade,
  page_path text not null check (page_path <> ''),
  page_id text,
  text text not null check (octet_length(text) <= 5242880),
  base_commit text,
  base_hash text,
  revision integer not null default 1 check (revision >= 1),
  write_id text,
  touched_at timestamptz not null default now(),
  unique (project_id, user_id, page_path)
);
create index if not exists wiki_draft_page_idx on knowledge.wiki_draft (project_id, page_path, touched_at desc);

-- A file attached to a draft, published with it.
create table if not exists knowledge.wiki_draft_attachment (
  draft_id uuid not null references knowledge.wiki_draft(id) on delete cascade,
  name text not null check (name <> ''),
  content_type text not null,
  bytes bytea not null,
  size integer not null check (size >= 0),
  unique (draft_id, name)
);

-- Who may edit or publish under a path prefix (a file, or a folder ending in "/"); a restriction only narrows.
create table if not exists knowledge.wiki_restriction (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references admin.project(id) on delete cascade,
  path_prefix text not null check (path_prefix <> '' and path_prefix not like '/%'),
  subject_kind text not null check (subject_kind in ('user', 'role')),
  subject_id text not null check (subject_id <> ''),
  kind text not null check (kind in ('edit', 'publish')),
  created_by text,
  created_at timestamptz not null default now(),
  unique (project_id, path_prefix, subject_kind, subject_id, kind)
);
