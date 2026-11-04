// Notifications in Postgres (core.notification, migration 058). A notification is inserted by one statement that also tells the
// change feed, so the person's open streams hear of it exactly when it is stored (and not at all for a repeat).

import { Injectable } from "@nestjs/common";
import { getPool } from "#common/db/pool.js";
import type { NewNotification, NotificationKind, NotificationRow, NotificationSubject } from "../domain/notification.js";
import { NotificationStore, type UserName } from "../domain/notification.store.js";

interface Row {
  id: string;
  user_id: string;
  project_id: string;
  kind: NotificationKind;
  subject: NotificationSubject;
  created_at: Date;
  read_at: Date | null;
}

const toRow = (row: Row): NotificationRow => ({
  id: row.id,
  userId: row.user_id,
  projectId: row.project_id,
  kind: row.kind,
  subject: row.subject,
  createdAt: row.created_at.toISOString(),
  readAt: row.read_at === null ? null : row.read_at.toISOString(),
});

@Injectable()
export class PgNotificationStore extends NotificationStore {
  async insert(notification: NewNotification): Promise<boolean> {
    const result = await getPool().query<{ announced: boolean }>(
      `with inserted as (
         insert into core.notification (user_id, project_id, kind, subject, dedupe_key)
         values ($1, $2, $3, $4::jsonb, $5)
         on conflict (dedupe_key) do nothing
         returning user_id
       )
       select pg_notify('kintsugi_change', json_build_object('t', 'notifications', 's', user_id)::text) is not null as announced from inserted`,
      [notification.userId, notification.projectId, notification.kind, JSON.stringify(notification.subject), notification.dedupeKey],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async list(userId: string, projectIds: readonly string[], options: { unread: boolean; limit: number; before: string | undefined }): Promise<NotificationRow[]> {
    const result = await getPool().query<Row>(
      `select id, user_id, project_id, kind, subject, created_at, read_at
         from core.notification
        where user_id = $1 and project_id = any($2::text[])
          and ($3::boolean = false or read_at is null)
          and ($4::timestamptz is null or created_at < $4::timestamptz)
        order by created_at desc, id desc
        limit $5`,
      [userId, projectIds, options.unread, options.before ?? null, options.limit],
    );
    return result.rows.map(toRow);
  }

  async countUnread(userId: string, projectIds: readonly string[]): Promise<number> {
    const result = await getPool().query<{ count: string }>("select count(*)::text as count from core.notification where user_id = $1 and project_id = any($2::text[]) and read_at is null", [userId, projectIds]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async markRead(userId: string, projectIds: readonly string[], target: { ids: readonly string[] } | { all: true }): Promise<number> {
    // Only the caller's own rows of projects they can open: an id that is another person's changes nothing.
    const result =
      "all" in target
        ? await getPool().query("update core.notification set read_at = now() where user_id = $1 and project_id = any($2::text[]) and read_at is null", [userId, projectIds])
        : await getPool().query("update core.notification set read_at = now() where user_id = $1 and project_id = any($2::text[]) and read_at is null and id = any($3::uuid[])", [userId, projectIds, target.ids]);
    return result.rowCount ?? 0;
  }

  async users(ids: readonly string[]): Promise<Map<string, UserName>> {
    if (ids.length === 0) return new Map();
    const result = await getPool().query<{ id: string; username: string; display_name: string }>("select id, username, display_name from core.app_user where id = any($1::text[])", [[...new Set(ids)]]);
    return new Map(result.rows.map((row) => [row.id, { username: row.username, displayName: row.display_name === "" ? row.username : row.display_name }]));
  }
}
