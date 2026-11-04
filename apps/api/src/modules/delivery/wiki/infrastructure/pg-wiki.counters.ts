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

  async startAfter(projectId: string, scope: string, highest: number): Promise<void> {
    await getPool().query(
      `insert into knowledge.wiki_id_counter (project_id, scope, next) values ($1, $2, $3)
       on conflict (project_id, scope) do update set next = greatest(knowledge.wiki_id_counter.next, excluded.next)`,
      [projectId, scope, Math.max(1, highest + 1)],
    );
  }

  /** The ids of the pages the index holds are the `ids` of their document nodes; the scope is capital letters and digits, so it is safe in the pattern. */
  async highestInBrain(projectId: string, scope: string): Promise<number> {
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(scope)) return 0;
    const result = await getPool().query<{ highest: string | null }>(
      `select max(substring(ref.value from $3::text)::bigint) as highest
         from knowledge.brain_node n, unnest(n.ids) as ref(value)
        where n.project_id = $1 and n.kind = 'document' and ref.value like $2::text`,
      [projectId, `PAGE-${scope}-%`, `^PAGE-${scope}-([0-9]+)$`],
    );
    return Number(result.rows[0]?.highest ?? 0);
  }
}
