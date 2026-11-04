// The people and roles that restrictions name, from the identity tables (core.app_user, core.user_role, core.role).

import { Injectable } from "@nestjs/common";
import { getPool } from "#common/db/pool.js";
import type { WikiSubjectKind } from "../domain/wiki.js";
import { WikiSubjects } from "../domain/wiki.ports.js";

@Injectable()
export class PgWikiSubjects extends WikiSubjects {
  async rolesOf(userId: string): Promise<string[]> {
    const result = await getPool().query<{ role_id: string }>("select role_id from core.user_role where user_id = $1 order by role_id", [userId]);
    return result.rows.map((row) => row.role_id);
  }

  async names(kind: WikiSubjectKind, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const result =
      kind === "user"
        ? await getPool().query<{ id: string; name: string }>("select id, coalesce(nullif(display_name, ''), username) as name from core.app_user where id = any($1::text[])", [[...ids]])
        : await getPool().query<{ id: string; name: string }>("select id, name from core.role where id = any($1::text[])", [[...ids]]);
    return new Map(result.rows.map((row) => [row.id, row.name]));
  }
}
