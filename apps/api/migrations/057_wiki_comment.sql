-- Comments on wiki pages (ADR-0099 decision 1): rows of the database, never written to Git and never part of the Brain.
-- A comment belongs to a project and a page, is anchored to a passage of it or to the whole page, and may have answers
-- (one level). Deleting one only blanks it, so the answers keep something to hang on.

create table if not exists knowledge.wiki_comment (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references admin.project(id) on delete cascade,
  -- The id of the page (PAGE-…), or `path:<path>` for a page that has none.
  page_key text not null check (page_key <> ''),
  -- The page's path when the comment was written; a page with an id keeps its comments through a move.
  path_at_write text not null,
  -- The comment this one answers; only a comment of the page that is not an answer itself (the service checks).
  parent_id uuid references knowledge.wiki_comment(id) on delete cascade,
  author_id text not null references core.app_user(id) on delete cascade,
  body text not null check (char_length(body) <= 8000),
  -- null: a comment on the page as a whole; else { node, exact, prefix, suffix, commit }.
  anchor jsonb,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by text references core.app_user(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index if not exists wiki_comment_page_idx on knowledge.wiki_comment (project_id, page_key, created_at);
create index if not exists wiki_comment_parent_idx on knowledge.wiki_comment (parent_id) where parent_id is not null;

-- The people a comment names, kept apart so the notification job and a search need not read the text.
create table if not exists knowledge.wiki_comment_mention (
  comment_id uuid not null references knowledge.wiki_comment(id) on delete cascade,
  user_id text not null references core.app_user(id) on delete cascade,
  primary key (comment_id, user_id)
);
create index if not exists wiki_comment_mention_user_idx on knowledge.wiki_comment_mention (user_id);
