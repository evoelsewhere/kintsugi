// The people a mention can name: users with Project Access on the project (admin.project_access), enabled, with the name
// they are shown by and never their email address.

import { Injectable } from "@nestjs/common";
import { getPool } from "#common/db/pool.js";
import { type WikiPerson, WikiPeople } from "../domain/wiki.ports.js";

/** The text as the inside of a LIKE pattern: `!`, `%` and `_` stand for themselves (ESCAPE '!'). */
const likeLiteral = (text: string): string => text.replace(/[!%_]/g, (char) => `!${char}`);

@Injectable()
export class PgWikiPeople extends WikiPeople {
  async search(projectId: string, query: string, limit: number): Promise<WikiPerson[]> {
    const literal = likeLiteral(query.trim().toLowerCase());
    const result = await getPool().query<{ id: string; username: string; name: string }>(
      `select u.id, u.username, coalesce(nullif(u.display_name, ''), u.username) as name
         from core.app_user u
         join admin.project_access a on a.user_id = u.id and a.project_id = $1
        where u.enabled
          and ($2 = '' or lower(u.username) like '%' || $2 || '%' escape '!' or lower(u.display_name) like '%' || $2 || '%' escape '!')
        order by (lower(u.username) like $2 || '%' escape '!' or lower(u.display_name) like $2 || '%' escape '!') desc, u.username
        limit $3`,
      [projectId, literal, limit],
    );
    return result.rows.map((row) => ({ id: row.id, username: row.username, displayName: row.name }));
  }

  async byUsernames(projectId: string, usernames: readonly string[]): Promise<Array<{ id: string; username: string }>> {
    if (usernames.length === 0) return [];
    const result = await getPool().query<{ id: string; username: string }>(
      `select u.id, u.username
         from core.app_user u
         join admin.project_access a on a.user_id = u.id and a.project_id = $1
        where u.enabled and lower(u.username) = any($2::text[])`,
      [projectId, usernames.map((name) => name.toLowerCase())],
    );
    return result.rows;
  }
}
