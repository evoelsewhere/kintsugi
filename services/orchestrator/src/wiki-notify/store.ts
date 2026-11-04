// What the wiki-notify job reads and writes in Postgres (migration 058): the cursor, the watchers who still have Project
// Access, the people behind commits, the spaces of the Brain, and the notifications. A notification holds ids only.

import type { Pool } from "pg";

/** A notification to create: `subject` has only the keys of the notification contract (ids, never text). */
export interface NewWikiNotification {
  userId: string;
  projectId: string;
  /** `wiki-page-changed:<user>:<page key>:<commit>`: a person is told once about a page at a commit. */
  dedupeKey: string;
  subject: { pageKey: string; commit: string; actorId?: string };
}

export interface WikiWatcher {
  userId: string;
  scopeKind: "page" | "folder" | "space";
  target: string;
}

const INSERT_BATCH = 500;

export class PgWikiNotifyStore {
  constructor(private readonly pool: Pool) {}

  /** The commit the watchers were told about last; undefined for a project the job has not seen. */
  async cursor(projectId: string): Promise<string | undefined> {
    const result = await this.pool.query<{ notified_commit: string }>("select notified_commit from knowledge.wiki_notify_cursor where project_id = $1", [projectId]);
    return result.rows[0]?.notified_commit;
  }

  async setCursor(projectId: string, commit: string): Promise<void> {
    await this.pool.query(
      `insert into knowledge.wiki_notify_cursor (project_id, notified_commit) values ($1, $2)
       on conflict (project_id) do update set notified_commit = excluded.notified_commit, updated_at = now()`,
      [projectId, commit],
    );
  }

  /** The projects whose wiki is on and whose Brain is built at a commit the watchers were not told about: what the sweep asks for. */
  async due(): Promise<Array<{ projectId: string; from: string | null; to: string }>> {
    const result = await this.pool.query<{ project_id: string; notified_commit: string | null; indexed_commit: string }>(
      `select s.project_id, c.notified_commit, s.indexed_commit
         from knowledge.brain_source s
         left join knowledge.wiki_notify_cursor c on c.project_id = s.project_id
        where s.enabled and s.wiki and s.state = 'ready' and s.indexed_commit is not null
          and c.notified_commit is distinct from s.indexed_commit`,
    );
    return result.rows.map((row) => ({ projectId: row.project_id, from: row.notified_commit, to: row.indexed_commit }));
  }

  /** The space key the Brain gives each path: the page's own, else that of the nearest folder above it that has one. */
  async spaces(projectId: string, paths: readonly string[]): Promise<Map<string, string | null>> {
    const folders = new Set<string>();
    for (const path of paths) {
      const parts = path.split("/").slice(0, -1);
      for (let length = parts.length; length > 0; length -= 1) folders.add(parts.slice(0, length).join("/"));
    }
    const result = await this.pool.query<{ path: string; space: string | null }>(
      `select path, space from knowledge.brain_node where project_id = $1 and kind in ('document', 'folder') and space is not null and path = any($2::text[])`,
      [projectId, [...paths, ...folders]],
    );
    const spaceOf = new Map(result.rows.map((row) => [row.path, row.space]));
    const found = new Map<string, string | null>();
    for (const path of paths) {
      let space = spaceOf.get(path) ?? null;
      for (let slash = path.lastIndexOf("/"); space === null && slash > 0; slash = path.lastIndexOf("/", slash - 1)) space = spaceOf.get(path.slice(0, slash)) ?? null;
      found.set(path, space);
    }
    return found;
  }

  /**
   * The watches that name any of the targets, for enabled people who have Project Access on the project now (the same
   * grant the API's guard checks, `admin.project_access`): a watch of someone who lost access tells them nothing.
   */
  async watchers(projectId: string, targets: { pages: readonly string[]; folders: readonly string[]; spaces: readonly string[] }): Promise<WikiWatcher[]> {
    const result = await this.pool.query<{ user_id: string; scope_kind: WikiWatcher["scopeKind"]; target: string }>(
      `select w.user_id, w.scope_kind, w.target
         from knowledge.wiki_watch w
         join admin.project_access a on a.project_id = w.project_id and a.user_id = w.user_id
         join core.app_user u on u.id = w.user_id and u.enabled
        where w.project_id = $1
          and ((w.scope_kind = 'page' and w.target = any($2::text[]))
            or (w.scope_kind = 'folder' and w.target = any($3::text[]))
            or (w.scope_kind = 'space' and w.target = any($4::text[])))`,
      [projectId, [...targets.pages], [...targets.folders], [...targets.spaces]],
    );
    return result.rows.map((row) => ({ userId: row.user_id, scopeKind: row.scope_kind, target: row.target }));
  }

  /** The account of each identity a commit names: a user name, an id (a `Kintsugi-Actor` trailer) or an e-mail address (a commit from a clone). */
  async usersOf(identities: readonly string[]): Promise<Map<string, string>> {
    const names = [...new Set(identities)];
    if (names.length === 0) return new Map();
    const result = await this.pool.query<{ id: string; username: string; email: string }>(
      "select id, username, lower(email) as email from core.app_user where id = any($1::text[]) or username = any($1::text[]) or lower(email) = any($1::text[])",
      [names],
    );
    const found = new Map<string, string>();
    for (const row of result.rows) for (const key of [row.id, row.username, row.email]) if (key !== "") found.set(key, row.id);
    return found;
  }

  /** The person on whose behalf each write that brought these commits in was made (`document_write.actor`), by commit. */
  async writeActors(projectId: string, commits: readonly string[]): Promise<Map<string, string>> {
    if (commits.length === 0) return new Map();
    const result = await this.pool.query<{ actor: string; commit_sha: string | null; merge_commit: string | null }>(
      "select actor, commit_sha, merge_commit from workflow.document_write where project_id = $1 and actor is not null and (commit_sha = any($2::text[]) or merge_commit = any($2::text[]))",
      [projectId, [...commits]],
    );
    const found = new Map<string, string>();
    for (const row of result.rows) for (const commit of [row.commit_sha, row.merge_commit]) if (commit !== null) found.set(commit, row.actor);
    return found;
  }

  /** Creates the notifications that do not exist yet (the unique `dedupe_key`); the number created. */
  async create(notifications: readonly NewWikiNotification[]): Promise<number> {
    let created = 0;
    for (let at = 0; at < notifications.length; at += INSERT_BATCH) {
      const batch = notifications.slice(at, at + INSERT_BATCH);
      const result = await this.pool.query<{ created: number }>(
        // The change feed hears each person it is for, as it does for a notification the API makes (topic `notifications`, the
        // person's id as scope), so a bell that is open refreshes; the notice carries no content.
        `with inserted as (
           insert into core.notification (user_id, project_id, kind, subject, dedupe_key)
           select user_id, project_id, 'wiki-page-changed', subject::jsonb, dedupe_key
             from unnest($1::text[], $2::text[], $3::text[], $4::text[]) as n(user_id, project_id, subject, dedupe_key)
           on conflict (dedupe_key) do nothing
           returning user_id
         ), announced as (
           select pg_notify('kintsugi_change', json_build_object('t', 'notifications', 's', user_id)::text) from (select distinct user_id from inserted) as people
         )
         select (select count(*) from inserted)::int as created, (select count(*) from announced) as announced`,
        [batch.map((item) => item.userId), batch.map((item) => item.projectId), batch.map((item) => JSON.stringify(item.subject)), batch.map((item) => item.dedupeKey)],
      );
      created += (result.rows[0] as { created: number } | undefined)?.created ?? 0;
    }
    return created;
  }
}
