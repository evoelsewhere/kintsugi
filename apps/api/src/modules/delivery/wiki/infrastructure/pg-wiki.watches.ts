// A person's watches in Postgres (knowledge.wiki_watch).

import { Injectable } from "@nestjs/common";
import { getPool, withTransaction } from "#common/db/pool.js";
import type { WikiWatch, WikiWatchScope } from "../domain/wiki.js";
import { WIKI_WATCH_LIMIT, WikiWatches } from "../domain/wiki.ports.js";

interface WatchRow {
  scope_kind: WikiWatchScope;
  target: string;
  created_at: Date;
}

const toWatch = (row: WatchRow): WikiWatch => ({ scopeKind: row.scope_kind, target: row.target, createdAt: row.created_at.toISOString() });

@Injectable()
export class PgWikiWatches extends WikiWatches {
  async listOf(projectId: string, userId: string): Promise<WikiWatch[]> {
    const result = await getPool().query<WatchRow>("select scope_kind, target, created_at from knowledge.wiki_watch where project_id = $1 and user_id = $2 order by created_at desc, scope_kind, target", [projectId, userId]);
    return result.rows.map(toWatch);
  }

  async add(projectId: string, userId: string, scopeKind: WikiWatchScope, target: string): Promise<{ created: boolean } | undefined> {
    // Counting then inserting is a race between two requests, whatever one statement does: a person's additions take turns.
    return withTransaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify(["wiki-watch", projectId, userId])]);
      const existing = await tx.query("select 1 from knowledge.wiki_watch where project_id = $1 and user_id = $2 and scope_kind = $3 and target = $4", [projectId, userId, scopeKind, target]);
      if ((existing.rowCount ?? 0) > 0) return { created: false };
      const inserted = await tx.query(
        `insert into knowledge.wiki_watch (project_id, user_id, scope_kind, target)
         select $1, $2, $3, $4 where (select count(*) from knowledge.wiki_watch where project_id = $1 and user_id = $2) < $5`,
        [projectId, userId, scopeKind, target, WIKI_WATCH_LIMIT],
      );
      return (inserted.rowCount ?? 0) > 0 ? { created: true } : undefined;
    });
  }

  async remove(projectId: string, userId: string, scopeKind: WikiWatchScope, target: string): Promise<boolean> {
    return ((await getPool().query("delete from knowledge.wiki_watch where project_id = $1 and user_id = $2 and scope_kind = $3 and target = $4", [projectId, userId, scopeKind, target])).rowCount ?? 0) > 0;
  }

  async watchersOf(projectId: string, targets: ReadonlyArray<{ scopeKind: WikiWatchScope; target: string }>): Promise<string[]> {
    if (targets.length === 0) return [];
    const result = await getPool().query<{ user_id: string }>(
      `select distinct user_id from knowledge.wiki_watch
        where project_id = $1 and (scope_kind, target) in (select * from unnest($2::text[], $3::text[]))
        order by user_id`,
      [projectId, targets.map((entry) => entry.scopeKind), targets.map((entry) => entry.target)],
    );
    return result.rows.map((row) => row.user_id);
  }

  async among(projectId: string, userId: string, targets: ReadonlyArray<{ scopeKind: WikiWatchScope; target: string }>): Promise<WikiWatch[]> {
    if (targets.length === 0) return [];
    const result = await getPool().query<WatchRow>(
      `select scope_kind, target, created_at from knowledge.wiki_watch
        where project_id = $1 and user_id = $2 and (scope_kind, target) in (select * from unnest($3::text[], $4::text[]))`,
      [projectId, userId, targets.map((entry) => entry.scopeKind), targets.map((entry) => entry.target)],
    );
    return result.rows.map(toWatch);
  }
}
