// The counters of page ids in Postgres (knowledge.wiki_id_counter).

import { Injectable } from "@nestjs/common";
import { getPool } from "#common/db/pool.js";
import { WikiIdCounters } from "../domain/wiki.ports.js";

@Injectable()
export class PgWikiIdCounters extends WikiIdCounters {
  /** One statement: the first call creates the row at 2 and hands out 1, later ones raise it; concurrent calls queue on the row. */
  async next(projectId: string, scope: string): Promise<number> {
    const result = await getPool().query<{ issued: number }>(
      `insert into knowledge.wiki_id_counter (project_id, scope, next) values ($1, $2, 2)
       on conflict (project_id, scope) do update set next = knowledge.wiki_id_counter.next + 1
       returning next - 1 as issued`,
      [projectId, scope],
    );
    return result.rows[0]!.issued;
  }
}
