-- Watches and notifications of the wiki (ADR-0099 decision 3): who watches which page, folder or space, the notifications
-- that reach a person (references only, never the text of a page), and where the worker's notify job stopped.

-- A person's watch of a page, a folder or a space. `target` is the page id (`path:<path>` for a page that has none), the
-- folder's path without a trailing slash, or the space key. At most 500 a person and project: the service refuses more.
create table if not exists knowledge.wiki_watch (
  project_id text not null references admin.project(id) on delete cascade,
  user_id text not null references core.app_user(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('page', 'folder', 'space')),
  target text not null check (target <> ''),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id, scope_kind, target)
);
-- The notify job looks up who watches what changed.
create index if not exists wiki_watch_target_idx on knowledge.wiki_watch (project_id, scope_kind, target);

-- A notification for one person. `subject` holds ids only ({ pageKey, commit, commentId, actorId }): the inbox looks the
-- names up when it is read, for people who still have Project Access. `dedupe_key` makes a notification once.
create table if not exists core.notification (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references core.app_user(id) on delete cascade,
  project_id text not null references admin.project(id) on delete cascade,
  kind text not null check (kind in ('wiki-page-changed', 'wiki-comment', 'wiki-mention')),
  subject jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dedupe_key text not null unique
);
create index if not exists notification_user_idx on core.notification (user_id, read_at, created_at desc);

-- The default-branch commit the notify job has told the watchers about, per project: the next run starts from it.
create table if not exists knowledge.wiki_notify_cursor (
  project_id text primary key references admin.project(id) on delete cascade,
  notified_commit text not null,
  updated_at timestamptz not null default now()
);
