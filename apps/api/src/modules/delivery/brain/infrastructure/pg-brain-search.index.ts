// The full-text index of the Brain in Postgres (knowledge.brain_text: one vector of lexemes per document, section and card,
// built with the tree), asked with the words a person typed. The nodes come back through the worker's own store, so both
// sides read a node the same way.

import { Injectable } from "@nestjs/common";
import type { BrainNode } from "@kintsugi/domain";
import { PgBrainStore } from "@kintsugi/orchestrator/brain";
import { getPool } from "#common/db/pool.js";
import type { BrainSearchFound, BrainSearchFounds, BrainSearchRequest } from "../domain/brain.search.js";
import { BrainSearchIndex } from "../domain/brain.ports.js";

/** The page (document node) of a hit: its space, labels and status are what narrows and hides. */
const FROM = `
  from knowledge.brain_text t
  join knowledge.brain_node n on n.project_id = t.project_id and n.id = t.node_id
  join knowledge.brain_node d on d.project_id = n.project_id and d.id = n.path and d.kind = 'document'
  cross join (select case when $2 = 'web' then websearch_to_tsquery('simple', $7) else to_tsquery('simple', $7) end as query) q
 where t.project_id = $1 and t.tsv @@ q.query
   and n.path !~ '(^|/)(_generated|restricted)(/|$)'
   and ($3::text is null or d.space = $3)
   and ($4::text is null or $4 = any(d.labels))`;

@Injectable()
export class PgBrainSearchIndex extends BrainSearchIndex {
  async search(projectId: string, request: BrainSearchRequest): Promise<BrainSearchFounds> {
    // `any`: each word between quotes (a word is letters and digits only), any of them; `web`: the text, which Postgres reads leniently.
    const text = request.query.kind === "web" ? request.query.text : request.query.terms.map((term) => `'${term}'`).join(" | ");
    const filters = [projectId, request.query.kind, request.space ?? null, request.label ?? null];
    const pool = getPool();
    const ranked = await pool.query<{ node_id: string; rank: number }>(
      `select t.node_id, ts_rank_cd(t.tsv, q.query)::float8 as rank ${FROM}
         and ($5::boolean or (d.status is distinct from 'archived' and not d.template))
       order by rank desc, n.path, n.line_start nulls first, t.node_id
       limit $6`,
      [...filters, request.includeHidden, request.limit, text],
    );
    // How many pages the words would have found among the ones left out: archived ones and templates.
    const left = request.includeHidden
      ? { rows: [{ archived: 0, templates: 0 }] }
      : await pool.query<{ archived: number; templates: number }>(
          `select count(distinct d.id) filter (where d.status = 'archived')::int as archived, count(distinct d.id) filter (where d.template and d.status is distinct from 'archived')::int as templates ${FROM}
             and (d.status = 'archived' or d.template) and $5::boolean is not null and $6::int is not null`,
          [...filters, false, 0, text],
        );
    const nodes = new Map<string, BrainNode>((await new PgBrainStore(pool).nodesByIds(projectId, ranked.rows.map((row) => row.node_id))).map((node) => [node.id, node]));
    const hits: BrainSearchFound[] = ranked.rows.flatMap((row) => {
      const node = nodes.get(row.node_id);
      return node === undefined ? [] : [{ node, rank: row.rank }];
    });
    return { hits, leftOut: { archived: left.rows[0]?.archived ?? 0, templates: left.rows[0]?.templates ?? 0 } };
  }
}
