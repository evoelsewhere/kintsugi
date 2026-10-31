// The Brain's Postgres store (ADR-0091, migration 043): the index state of each project and its tree. The worker
// writes a tree whole when the branch moves; the API and the member bridge read it. Reads never touch Git: a node
// carries its line range, and the caller reads those lines from the mirror at the indexed commit.

import type { Pool, PoolClient } from "pg";
import {
  BRAIN_ROOT_ID,
  type BrainIndexState,
  type BrainLink,
  type BrainLinks,
  type BrainNode,
  type BrainNodeKind,
  type BrainNodePage,
  type BrainSource,
  type BrainSummarySource,
  type BrainTree,
} from "@kintsugi/domain";
import { withPgTransaction } from "../postgres.js";

export interface BrainBuildStats {
  durationMs: number;
}

interface SourceRow {
  project_id: string;
  branch: string;
  enabled: boolean;
  state: BrainIndexState;
  indexed_commit: string | null;
  attempted_commit: string | null;
  indexed_at: Date | null;
  builder_version: number | null;
  documents: number;
  nodes: number;
  identifiers: number;
  links: number;
  tokens: string;
  skipped: number;
  duration_ms: number | null;
  error: string | null;
  requested_at: Date;
  started_at: Date | null;
  updated_by: string | null;
  updated_at: Date;
}

interface NodeRow {
  id: string;
  parent_id: string | null;
  kind: BrainNodeKind;
  path: string;
  anchor: string | null;
  title: string;
  summary: string;
  summary_source: BrainSummarySource;
  ordinal: number;
  depth: number;
  line_start: number | null;
  line_end: number | null;
  subtree_end: number | null;
  tokens: number;
  subtree_tokens: string;
  children: number;
  ids: string[];
}

const NODE_COLUMNS =
  "id, parent_id, kind, path, anchor, title, summary, summary_source, ordinal, depth, line_start, line_end, subtree_end, tokens, subtree_tokens, children, ids";
/** Rows per insert statement while a tree is written. */
const INSERT_CHUNK = 1000;
const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

function toSource(row: SourceRow): BrainSource {
  return {
    projectId: row.project_id,
    branch: row.branch,
    enabled: row.enabled,
    state: row.state,
    indexedCommit: row.indexed_commit,
    attemptedCommit: row.attempted_commit,
    indexedAt: iso(row.indexed_at),
    builderVersion: row.builder_version,
    documents: row.documents,
    nodes: row.nodes,
    identifiers: row.identifiers,
    links: row.links,
    tokens: Number(row.tokens),
    skipped: row.skipped,
    durationMs: row.duration_ms,
    error: row.error,
    requestedAt: row.requested_at.toISOString(),
    startedAt: iso(row.started_at),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
  };
}

function toNode(row: NodeRow): BrainNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    kind: row.kind,
    path: row.path,
    anchor: row.anchor,
    title: row.title,
    summary: row.summary,
    summarySource: row.summary_source,
    ordinal: row.ordinal,
    depth: row.depth,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    subtreeEnd: row.subtree_end,
    tokens: row.tokens,
    subtreeTokens: Number(row.subtree_tokens),
    children: row.children,
    ids: row.ids,
  };
}

export class PgBrainStore {
  constructor(private readonly db: Pool) {}

  async source(projectId: string): Promise<BrainSource | undefined> {
    const result = await this.db.query<SourceRow>("select * from knowledge.brain_source where project_id = $1", [projectId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toSource(row);
  }

  /** Sets the branch and whether the index is kept; an enabled index is queued for a build. */
  async configure(projectId: string, input: { branch: string; enabled: boolean }, actor: string): Promise<BrainSource> {
    const result = await this.db.query<SourceRow>(
      `insert into knowledge.brain_source (project_id, branch, enabled, state, updated_by)
       values ($1, $2, $3, 'queued', $4)
       on conflict (project_id) do update set
         branch = excluded.branch,
         enabled = excluded.enabled,
         state = case when excluded.enabled then 'queued' else knowledge.brain_source.state end,
         attempted_commit = case when excluded.branch = knowledge.brain_source.branch then knowledge.brain_source.attempted_commit end,
         requested_at = now(), updated_by = excluded.updated_by, updated_at = now()
       returning *`,
      [projectId, input.branch, input.enabled, actor],
    );
    return toSource(result.rows[0] as SourceRow);
  }

  /** Queues a build of an enabled index; undefined when the project has none or it is off. */
  async request(projectId: string, actor: string | null): Promise<BrainSource | undefined> {
    const result = await this.db.query<SourceRow>(
      `update knowledge.brain_source
          set state = case when state = 'indexing' then state else 'queued' end, attempted_commit = null,
              requested_at = now(), updated_by = coalesce($2, updated_by), updated_at = now()
        where project_id = $1 and enabled
        returning *`,
      [projectId, actor],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toSource(row);
  }

  /** Marks a build as started; undefined when the index is gone or off. */
  async begin(projectId: string): Promise<BrainSource | undefined> {
    const result = await this.db.query<SourceRow>(
      `update knowledge.brain_source set state = 'indexing', started_at = now(), error = null, updated_at = now()
        where project_id = $1 and enabled returning *`,
      [projectId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toSource(row);
  }

  async attempt(projectId: string, commit: string): Promise<void> {
    await this.db.query("update knowledge.brain_source set attempted_commit = $2 where project_id = $1", [projectId, commit]);
  }

  async fail(projectId: string, error: string): Promise<void> {
    await this.db.query(
      "update knowledge.brain_source set state = 'failed', error = $2, updated_at = now() where project_id = $1",
      [projectId, error.slice(0, 2000)],
    );
  }

  /** Replaces the project's tree with one built from `commit`, in one transaction. */
  async replace(projectId: string, commit: string, builderVersion: number, tree: BrainTree, stats: BrainBuildStats): Promise<void> {
    await withPgTransaction(this.db, async (client) => {
      await client.query("set local statement_timeout = '120s'");
      await client.query("select 1 from knowledge.brain_source where project_id = $1 for update", [projectId]);
      await client.query("delete from knowledge.brain_link where project_id = $1", [projectId]);
      await client.query("delete from knowledge.brain_node where project_id = $1", [projectId]);
      await insertNodes(client, projectId, tree.nodes);
      await insertLinks(client, projectId, tree.links);
      const tokens = tree.nodes.find((node) => node.id === BRAIN_ROOT_ID)?.subtreeTokens ?? 0;
      await client.query(
        `update knowledge.brain_source
            set state = 'ready', indexed_commit = $2, attempted_commit = $2, indexed_at = now(), builder_version = $3,
                documents = $4, nodes = $5, identifiers = $6, links = $7, tokens = $8, skipped = $9, duration_ms = $10,
                error = null, updated_at = now()
          where project_id = $1`,
        [projectId, commit, builderVersion, tree.documents, tree.nodes.length, tree.identifiers, tree.links.length, tokens, tree.skipped, stats.durationMs],
      );
    });
  }

  /**
   * Enabled indexes whose build is due: never built, built by an older builder, queued or indexing for too long
   * (a worker that stopped), or built from another commit than `tips` gives for their branch — unless the last
   * build already failed on that commit.
   */
  async enabled(repositoryId?: string): Promise<Array<{ source: BrainSource; repositoryId: string }>> {
    const result = await this.db.query<SourceRow & { repository_id: string }>(
      `select s.*, l.repository_id
         from knowledge.brain_source s
         join admin.project_repository l on l.project_id = s.project_id and l.role = 'document'
        where s.enabled and ($1::text is null or l.repository_id = $1)`,
      [repositoryId ?? null],
    );
    return result.rows.map((row) => ({ source: toSource(row), repositoryId: row.repository_id }));
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async node(projectId: string, id: string): Promise<BrainNode | undefined> {
    const result = await this.db.query<NodeRow>(`select ${NODE_COLUMNS} from knowledge.brain_node where project_id = $1 and id = $2`, [projectId, id]);
    const row = result.rows[0];
    return row === undefined ? undefined : toNode(row);
  }

  async children(projectId: string, parentId: string, offset: number, limit: number): Promise<BrainNodePage> {
    const [items, total] = await Promise.all([
      this.db.query<NodeRow>(
        `select ${NODE_COLUMNS} from knowledge.brain_node where project_id = $1 and parent_id = $2 order by ordinal offset $3 limit $4`,
        [projectId, parentId, offset, limit],
      ),
      this.db.query<{ count: string }>("select count(*) from knowledge.brain_node where project_id = $1 and parent_id = $2", [projectId, parentId]),
    ]);
    return { items: items.rows.map(toNode), total: Number(total.rows[0]?.count ?? 0) };
  }

  /** The children of several nodes, at most `limit` each, in order. */
  async childrenOf(projectId: string, parentIds: readonly string[], limit: number): Promise<Map<string, BrainNode[]>> {
    const found = new Map<string, BrainNode[]>();
    if (parentIds.length === 0) return found;
    const result = await this.db.query<NodeRow>(
      `select ${NODE_COLUMNS} from knowledge.brain_node
        where project_id = $1 and parent_id = any($2::text[]) and ordinal < $3
        order by parent_id, ordinal`,
      [projectId, parentIds, limit],
    );
    for (const row of result.rows) {
      const node = toNode(row);
      if (node.parentId !== null) found.set(node.parentId, [...(found.get(node.parentId) ?? []), node]);
    }
    return found;
  }

  /** The node's ancestors, root first. */
  async ancestors(projectId: string, id: string): Promise<BrainNode[]> {
    const result = await this.db.query<NodeRow & { level: number }>(
      `with recursive up as (
         select ${NODE_COLUMNS}, 0 as level from knowledge.brain_node where project_id = $1 and id = $2
         union all
         select ${NODE_COLUMNS.split(", ").map((column) => `n.${column}`).join(", ")}, up.level + 1
           from knowledge.brain_node n join up on n.id = up.parent_id
          where n.project_id = $1 and up.level < 64
       )
       select * from up where level > 0 order by level desc`,
      [projectId, id],
    );
    return result.rows.map(toNode);
  }

  /** The nodes that define a reference id (a card, or a document whose front matter names it). */
  async lookup(projectId: string, id: string, limit: number): Promise<BrainNode[]> {
    const result = await this.db.query<NodeRow>(
      `select ${NODE_COLUMNS} from knowledge.brain_node where project_id = $1 and ids @> array[$2]::text[] order by path, line_start limit $3`,
      [projectId, id, limit],
    );
    return result.rows.map(toNode);
  }

  /** The folder or document at a repository path, for a reader who pasted a path. */
  async byPath(projectId: string, path: string, limit: number): Promise<BrainNode[]> {
    const result = await this.db.query<NodeRow>(
      `select ${NODE_COLUMNS} from knowledge.brain_node
        where project_id = $1 and kind in ('folder', 'document') and (path = $2 or id = $2)
        order by depth limit $3`,
      [projectId, path, limit],
    );
    return result.rows.map(toNode);
  }

  async links(projectId: string, id: string, limit: number): Promise<BrainLinks> {
    const query = (direction: "from" | "to") =>
      this.db.query<NodeRow & { link_kind: BrainLink["kind"] }>(
        `select ${NODE_COLUMNS.split(", ").map((column) => `n.${column}`).join(", ")}, l.kind as link_kind
           from knowledge.brain_link l
           join knowledge.brain_node n on n.project_id = l.project_id and n.id = l.${direction === "from" ? "to_id" : "from_id"}
          where l.project_id = $1 and l.${direction === "from" ? "from_id" : "to_id"} = $2
          order by n.path, n.line_start nulls first
          limit $3`,
        [projectId, id, limit],
      );
    const count = (direction: "from" | "to") =>
      this.db.query<{ count: string }>(`select count(*) from knowledge.brain_link where project_id = $1 and ${direction === "from" ? "from_id" : "to_id"} = $2`, [projectId, id]);
    const [outgoing, incoming, outgoingTotal, incomingTotal] = await Promise.all([query("from"), query("to"), count("from"), count("to")]);
    const withKind = (row: NodeRow & { link_kind: BrainLink["kind"] }) => ({ ...toNode(row), linkKind: row.link_kind });
    return {
      outgoing: outgoing.rows.map(withKind),
      incoming: incoming.rows.map(withKind),
      outgoingTotal: Number(outgoingTotal.rows[0]?.count ?? 0),
      incomingTotal: Number(incomingTotal.rows[0]?.count ?? 0),
    };
  }

  /** For each (path, line), the deepest node whose own text holds the line. */
  async nodesAtLines(projectId: string, hits: ReadonlyArray<{ path: string; line: number }>): Promise<Array<BrainNode | undefined>> {
    if (hits.length === 0) return [];
    const result = await this.db.query<NodeRow & { hit: number }>(
      `select distinct on (h.hit) h.hit, ${NODE_COLUMNS.split(", ").map((column) => `n.${column}`).join(", ")}
         from unnest($2::text[], $3::int[]) with ordinality as h(path, line, hit)
         join knowledge.brain_node n on n.project_id = $1 and n.path = h.path and n.line_start <= h.line and n.line_end >= h.line
        where n.kind in ('document', 'section', 'card')
        order by h.hit, n.depth desc`,
      [projectId, hits.map((hit) => hit.path), hits.map((hit) => hit.line)],
    );
    const found = new Map(result.rows.map((row) => [Number(row.hit), toNode(row)]));
    return hits.map((_, index) => found.get(index + 1));
  }
}

async function insertNodes(client: PoolClient, projectId: string, nodes: readonly BrainNode[]): Promise<void> {
  for (let start = 0; start < nodes.length; start += INSERT_CHUNK) {
    const chunk = nodes.slice(start, start + INSERT_CHUNK);
    const column = <T>(pick: (node: BrainNode) => T): T[] => chunk.map(pick);
    await client.query(
      `insert into knowledge.brain_node (project_id, ${NODE_COLUMNS})
       select $1, id, parent_id, kind, path, anchor, title, summary, summary_source, ordinal, depth, line_start, line_end, subtree_end,
              tokens, subtree_tokens, children, case when ids = '' then '{}'::text[] else string_to_array(ids, ' ') end
         from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::int[], $11::int[],
                     $12::int[], $13::int[], $14::int[], $15::int[], $16::bigint[], $17::int[], $18::text[])
           as t(id, parent_id, kind, path, anchor, title, summary, summary_source, ordinal, depth, line_start, line_end, subtree_end,
                tokens, subtree_tokens, children, ids)`,
      [
        projectId,
        column((node) => node.id),
        column((node) => node.parentId),
        column((node) => node.kind),
        column((node) => node.path),
        column((node) => node.anchor),
        column((node) => node.title),
        column((node) => node.summary),
        column((node) => node.summarySource),
        column((node) => node.ordinal),
        column((node) => node.depth),
        column((node) => node.lineStart),
        column((node) => node.lineEnd),
        column((node) => node.subtreeEnd),
        column((node) => node.tokens),
        column((node) => node.subtreeTokens),
        column((node) => node.children),
        column((node) => node.ids.join(" ")),
      ],
    );
  }
}

async function insertLinks(client: PoolClient, projectId: string, links: readonly BrainLink[]): Promise<void> {
  for (let start = 0; start < links.length; start += INSERT_CHUNK) {
    const chunk = links.slice(start, start + INSERT_CHUNK);
    await client.query(
      `insert into knowledge.brain_link (project_id, from_id, to_id, kind)
       select $1, from_id, to_id, kind from unnest($2::text[], $3::text[], $4::text[]) as t(from_id, to_id, kind)
       on conflict do nothing`,
      [projectId, chunk.map((link) => link.fromId), chunk.map((link) => link.toId), chunk.map((link) => link.kind)],
    );
  }
}
