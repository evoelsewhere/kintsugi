// The Brain's Postgres store (ADR-0091, migration 043): the index state of each project and its tree. The worker
// writes a tree whole when the branch moves; the API and the member bridge read it. Reads never touch Git: a node
// carries its line range, and the caller reads those lines from the mirror at the indexed commit.

import type { Pool, PoolClient } from "pg";
import {
  BRAIN_ROOT_ID,
  BRAIN_WHOLE_BUILD_EVERY,
  type BrainBacklinkRows,
  type BrainDocumentPart,
  type BrainHome,
  type BrainIndexState,
  type BrainLink,
  type BrainBrokenLink,
  type BrainLinks,
  type BrainNode,
  type BrainNodeKind,
  type BrainNodePage,
  type BrainRefRow,
  type BrainSource,
  type BrainSummarySource,
  type BrainTree,
  brainHomeOf,
  brainPartsFromRows,
  brainRefRows,
} from "@kintsugi/domain";
import { withPgTransaction } from "../postgres.js";

export interface BrainBuildStats {
  durationMs: number;
}

/** What the next build needs to know to choose between an incremental and a whole build. */
export interface BrainBuildState {
  /** Incremental builds since the last whole one. */
  incrementalBuilds: number;
  /** When the last whole build finished; null for an index no whole build of this version wrote. */
  wholeBuiltAt: string | null;
  /** Whether the stored references (`brain_ref`) are those of the stored tree: only a whole build writes them first. */
  refsComplete: boolean;
}

/** The stored tree is not the one an incremental build started from: another build got there first. */
export class StaleBaseError extends Error {
  constructor() {
    super("The stored Brain is no longer at the commit this build started from.");
  }
}

interface SourceRow {
  project_id: string;
  branch: string;
  enabled: boolean;
  wiki: boolean;
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
  labels: string[];
  status: string | null;
  owner: string | null;
  template: boolean;
  space: string | null;
  changed_commit: string | null;
  changed_at: Date | null;
  changed_subject: string | null;
}

/** A stored node with what only the store sees: the home data of its page and the links it has beyond those stored. */
interface StoredNodeRow extends NodeRow {
  outgoing_links: number;
  home: BrainHome | null;
}

const NODE_COLUMNS =
  "id, parent_id, kind, path, anchor, title, summary, summary_source, ordinal, depth, line_start, line_end, subtree_end, tokens, subtree_tokens, children, ids, labels, status, owner, template, space, changed_commit, changed_at, changed_subject";
/** Rows per insert statement while a tree is written. */
const INSERT_CHUNK = 1000;
const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

function toSource(row: SourceRow): BrainSource {
  return {
    projectId: row.project_id,
    branch: row.branch,
    enabled: row.enabled,
    wiki: row.wiki,
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
    labels: row.labels,
    status: row.status,
    owner: row.owner,
    template: row.template,
    space: row.space,
    changed: row.changed_commit === null || row.changed_at === null ? null : { commit: row.changed_commit, at: row.changed_at.toISOString(), subject: row.changed_subject ?? "" },
  };
}

export class PgBrainStore {
  constructor(private readonly db: Pool) {}

  async source(projectId: string): Promise<BrainSource | undefined> {
    const result = await this.db.query<SourceRow>("select * from knowledge.brain_source where project_id = $1", [projectId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toSource(row);
  }

  /** Sets the branch and whether the index is kept (and the wiki flag when given); an enabled index is queued for a build. */
  async configure(projectId: string, input: { branch: string; enabled: boolean; wiki?: boolean | undefined }, actor: string): Promise<BrainSource> {
    const result = await this.db.query<SourceRow>(
      `insert into knowledge.brain_source (project_id, branch, enabled, wiki, state, updated_by)
       values ($1, $2, $3, coalesce($5::boolean, false), 'queued', $4)
       on conflict (project_id) do update set
         branch = excluded.branch,
         enabled = excluded.enabled,
         wiki = coalesce($5::boolean, knowledge.brain_source.wiki),
         state = case when excluded.enabled then 'queued' else knowledge.brain_source.state end,
         attempted_commit = case when excluded.branch = knowledge.brain_source.branch then knowledge.brain_source.attempted_commit end,
         requested_at = now(), updated_by = excluded.updated_by, updated_at = now()
       returning *`,
      [projectId, input.branch, input.enabled, actor, input.wiki ?? null],
    );
    return toSource(result.rows[0] as SourceRow);
  }

  /** Sets the wiki flag alone, without queuing a build; undefined when the project has no index. */
  async setWiki(projectId: string, wiki: boolean, actor: string): Promise<BrainSource | undefined> {
    const result = await this.db.query<SourceRow>(
      "update knowledge.brain_source set wiki = $2, updated_by = $3, updated_at = now() where project_id = $1 returning *",
      [projectId, wiki, actor],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toSource(row);
  }

  /** Queues a build of an enabled index; undefined when the project has none or it is off. */
  async request(projectId: string, actor: string | null): Promise<BrainSource | undefined> {
    const result = await this.db.query<SourceRow>(
      `update knowledge.brain_source
          set state = case when state = 'indexing' then state else 'queued' end, attempted_commit = null,
              requested_at = now(), updated_by = coalesce($2, updated_by), updated_at = now(),
              -- A manager's Rebuild is a whole build; the sync that finds a new commit leaves the counter alone.
              incremental_builds = case when $2::text is not null then $3::int else incremental_builds end
        where project_id = $1 and enabled
        returning *`,
      [projectId, actor, BRAIN_WHOLE_BUILD_EVERY],
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

  /** What the next build needs to choose between an incremental and a whole build; undefined when the project has no index. */
  async buildState(projectId: string): Promise<BrainBuildState | undefined> {
    const result = await this.db.query<{ incremental_builds: number; whole_built_at: Date | null; refs_complete: boolean }>(
      "select incremental_builds, whole_built_at, refs_complete from knowledge.brain_source where project_id = $1",
      [projectId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { incrementalBuilds: row.incremental_builds, wholeBuiltAt: iso(row.whole_built_at), refsComplete: row.refs_complete };
  }

  /**
   * The parts of the documents the tree holds, except those of `exceptPaths` (the ones that changed), built again from
   * the stored node rows and references: what an incremental build assembles with the parts of the documents it read.
   */
  async parts(projectId: string, exceptPaths: readonly string[]): Promise<BrainDocumentPart[]> {
    const nodes = await this.db.query<StoredNodeRow>(
      `select ${NODE_COLUMNS}, outgoing_links, home from knowledge.brain_node
        where project_id = $1 and kind in ('document', 'section', 'card') and not (path = any($2::text[]))`,
      [projectId, exceptPaths],
    );
    const refs = await this.db.query<RefRow>(
      `select path, ordinal, from_id, kind, target_path, target_anchor, target_id from knowledge.brain_ref
        where project_id = $1 and not (path = any($2::text[]))`,
      [projectId, exceptPaths],
    );
    return brainPartsFromRows(
      nodes.rows.map((row) => ({ node: toNode(row), home: row.home })),
      refs.rows.map(toRef),
    );
  }

  /** Replaces the project's tree with one built from `commit`, in one transaction: the whole build. */
  async replace(projectId: string, commit: string, builderVersion: number, tree: BrainTree, stats: BrainBuildStats, parts: readonly BrainDocumentPart[]): Promise<void> {
    await withPgTransaction(this.db, async (client) => {
      await client.query("set local statement_timeout = '120s'");
      await client.query("select 1 from knowledge.brain_source where project_id = $1 for update", [projectId]);
      await client.query("delete from knowledge.brain_link where project_id = $1", [projectId]);
      await client.query("delete from knowledge.brain_ref where project_id = $1", [projectId]);
      await client.query("delete from knowledge.brain_node where project_id = $1", [projectId]);
      await insertNodes(client, projectId, tree.nodes, homesOf(parts, tree.nodes));
      await insertRefs(client, projectId, parts.flatMap(brainRefRows));
      await insertLinks(client, projectId, tree.links);
      await setLinkTotals(client, projectId, tree.nodes, tree.linkTotals);
      const tokens = tree.nodes.find((node) => node.id === BRAIN_ROOT_ID)?.subtreeTokens ?? 0;
      await client.query(
        `update knowledge.brain_source
            set state = 'ready', indexed_commit = $2, attempted_commit = $2, indexed_at = now(), builder_version = $3,
                documents = $4, nodes = $5, identifiers = $6, links = $7, tokens = $8, skipped = $9, duration_ms = $10,
                broken = $11::jsonb, incremental_builds = 0, whole_built_at = now(), last_build = 'whole', refs_complete = true,
                error = null, updated_at = now()
          where project_id = $1`,
        // The links to a page that is not there, in full for this build: a build replaces the list, it never adds to it.
        [projectId, commit, builderVersion, tree.documents, tree.nodes.length, tree.identifiers, tree.links.length, tokens, tree.skipped, stats.durationMs, JSON.stringify(tree.broken)],
      );
    });
  }

  /**
   * Brings the stored tree from the commit `base` to the one `tree` was assembled for, writing only the rows that are
   * not already as the tree has them, in one transaction (an incremental build). `changedPaths` are the documents whose
   * text changed or that are gone: their references are written again from `parts`. Throws `StaleBaseError`, and writes
   * nothing, when the index is no longer at `base`.
   */
  async applyDelta(
    projectId: string,
    base: string,
    commit: string,
    builderVersion: number,
    tree: BrainTree,
    stats: BrainBuildStats,
    parts: readonly BrainDocumentPart[],
    changedPaths: readonly string[],
  ): Promise<{ nodesWritten: number; nodesRemoved: number }> {
    return withPgTransaction(this.db, async (client) => {
      await client.query("set local statement_timeout = '120s'");
      const locked = await client.query<{ indexed_commit: string | null; refs_complete: boolean }>(
        "select indexed_commit, refs_complete from knowledge.brain_source where project_id = $1 for update",
        [projectId],
      );
      if (locked.rows[0]?.indexed_commit !== base || locked.rows[0]?.refs_complete !== true) throw new StaleBaseError();

      // Nodes: write those that are new or differ from the stored row in any column, remove those that are gone.
      const homes = homesOf(parts, tree.nodes);
      const stored = await client.query<StoredNodeRow>(`select ${NODE_COLUMNS}, outgoing_links, home from knowledge.brain_node where project_id = $1`, [projectId]);
      const before = new Map(stored.rows.map((row) => [row.id, canonical({ node: toNode(row), outgoing: row.outgoing_links, home: row.home })]));
      const write: BrainNode[] = [];
      const keep = new Set<string>();
      for (const node of tree.nodes) {
        keep.add(node.id);
        const now = canonical({ node, outgoing: tree.linkTotals[node.id] ?? 0, home: homes.get(node.id) ?? null });
        if (before.get(node.id) !== now) write.push(node);
      }
      const remove = [...before.keys()].filter((id) => !keep.has(id));
      const drop = [...new Set([...remove, ...write.map((node) => node.id)])];
      for (let start = 0; start < drop.length; start += INSERT_CHUNK) {
        await client.query("delete from knowledge.brain_node where project_id = $1 and id = any($2::text[])", [projectId, drop.slice(start, start + INSERT_CHUNK)]);
      }
      await insertNodes(client, projectId, write, homes);
      await setLinkTotals(client, projectId, write, tree.linkTotals);

      // Links: the set difference with what is stored.
      const linksStored = await client.query<{ from_id: string; to_id: string; kind: BrainLink["kind"] }>(
        "select from_id, to_id, kind from knowledge.brain_link where project_id = $1",
        [projectId],
      );
      const wanted = new Map(tree.links.map((link) => [`${link.fromId}\n${link.toId}`, link]));
      const have = new Map(linksStored.rows.map((row) => [`${row.from_id}\n${row.to_id}`, row]));
      const stale = [...have].filter(([key, row]) => wanted.get(key)?.kind !== row.kind).map(([, row]) => row);
      for (let start = 0; start < stale.length; start += INSERT_CHUNK) {
        const chunk = stale.slice(start, start + INSERT_CHUNK);
        await client.query(
          `delete from knowledge.brain_link l using unnest($2::text[], $3::text[]) as t(from_id, to_id)
            where l.project_id = $1 and l.from_id = t.from_id and l.to_id = t.to_id`,
          [projectId, chunk.map((row) => row.from_id), chunk.map((row) => row.to_id)],
        );
      }
      const staleKeys = new Set(stale.map((row) => `${row.from_id}\n${row.to_id}`));
      await insertLinks(client, projectId, tree.links.filter((link) => {
        const key = `${link.fromId}\n${link.toId}`;
        return !have.has(key) || staleKeys.has(key);
      }));

      // References: those of the documents that changed or went are replaced.
      await client.query("delete from knowledge.brain_ref where project_id = $1 and path = any($2::text[])", [projectId, changedPaths]);
      const changed = new Set(changedPaths);
      await insertRefs(client, projectId, parts.filter((part) => changed.has(part.path)).flatMap(brainRefRows));

      const tokens = tree.nodes.find((node) => node.id === BRAIN_ROOT_ID)?.subtreeTokens ?? 0;
      await client.query(
        `update knowledge.brain_source
            set state = 'ready', indexed_commit = $2, attempted_commit = $2, indexed_at = now(), builder_version = $3,
                documents = $4, nodes = $5, identifiers = $6, links = $7, tokens = $8, skipped = $9, duration_ms = $10,
                broken = $11::jsonb, incremental_builds = incremental_builds + 1, last_build = 'incremental',
                error = null, updated_at = now()
          where project_id = $1`,
        [projectId, commit, builderVersion, tree.documents, tree.nodes.length, tree.identifiers, tree.links.length, tokens, tree.skipped, stats.durationMs, JSON.stringify(tree.broken)],
      );
      return { nodesWritten: write.length, nodesRemoved: remove.length };
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

  /** The documents that carry a label (stored lowercase), by path; uses the GIN index of `labels`. */
  async byLabel(projectId: string, label: string, limit: number): Promise<BrainNode[]> {
    const result = await this.db.query<NodeRow>(
      `select ${NODE_COLUMNS} from knowledge.brain_node
        where project_id = $1 and kind = 'document' and labels @> array[$2]::text[]
        order by path collate "C" limit $3`,
      [projectId, label, limit],
    );
    return result.rows.map(toNode);
  }

  /**
   * The documents in the space of a key, by path. Both sides are compared in upper case, so an index built before keys
   * were upper-cased by the builder still answers `space:eng` (P-019).
   */
  async bySpace(projectId: string, space: string, limit: number): Promise<BrainNode[]> {
    const result = await this.db.query<NodeRow>(
      `select ${NODE_COLUMNS} from knowledge.brain_node
        where project_id = $1 and kind = 'document' and upper(space) = upper($2)
        order by path collate "C" limit $3`,
      [projectId, space, limit],
    );
    return result.rows.map(toNode);
  }

  /** The broken links the last build stored (an index that was never built has none). */
  async broken(projectId: string): Promise<BrainBrokenLink[]> {
    const result = await this.db.query<{ broken: BrainBrokenLink[] }>("select broken from knowledge.brain_source where project_id = $1", [projectId]);
    return result.rows[0]?.broken ?? [];
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
    // A node whose links were capped when they were stored counts all of them (P-036).
    const count = (direction: "from" | "to") =>
      this.db.query<{ count: string }>(
        direction === "from"
          ? "select greatest((select count(*) from knowledge.brain_link where project_id = $1 and from_id = $2), (select coalesce(max(outgoing_links), 0) from knowledge.brain_node where project_id = $1 and id = $2)) as count"
          : "select count(*) from knowledge.brain_link where project_id = $1 and to_id = $2",
        [projectId, id],
      );
    const [outgoing, incoming, outgoingTotal, incomingTotal] = await Promise.all([query("from"), query("to"), count("from"), count("to")]);
    const withKind = (row: NodeRow & { link_kind: BrainLink["kind"] }) => ({ ...toNode(row), linkKind: row.link_kind });
    return {
      outgoing: outgoing.rows.map(withKind),
      incoming: incoming.rows.map(withKind),
      outgoingTotal: Number(outgoingTotal.rows[0]?.count ?? 0),
      incomingTotal: Number(incomingTotal.rows[0]?.count ?? 0),
    };
  }

  /**
   * The links to a document (to the page itself or to any heading or card in it) or to one section or card, from the
   * nodes of other documents, ordered by the linking node's path and line; a window of them, with the total.
   */
  async backlinks(projectId: string, target: { id: string; path: string; kind: BrainNodeKind }, offset: number, limit: number): Promise<BrainBacklinkRows> {
    // The page's own headings are `path#anchor`; `starts_with` takes the path literally, with no LIKE wildcards.
    const where = `l.project_id = $1 and (l.to_id = $2 or ($3::boolean and starts_with(l.to_id, $4))) and n.path <> $5`;
    const params = [projectId, target.id, target.kind === "document", `${target.path}#`, target.path];
    const [page, count] = await Promise.all([
      this.db.query<{ from_id: string; to_id: string; kind: BrainLink["kind"] }>(
        `select l.from_id, l.to_id, l.kind
           from knowledge.brain_link l
           join knowledge.brain_node n on n.project_id = l.project_id and n.id = l.from_id
          where ${where}
          order by n.path collate "C", n.line_start nulls first, l.from_id collate "C", l.to_id collate "C"
          limit $6 offset $7`,
        [...params, limit, offset],
      ),
      this.db.query<{ count: string }>(
        `select count(*) from knowledge.brain_link l join knowledge.brain_node n on n.project_id = l.project_id and n.id = l.from_id where ${where}`,
        params,
      ),
    ]);
    return { rows: page.rows.map((row) => ({ fromId: row.from_id, toId: row.to_id, kind: row.kind })), total: Number(count.rows[0]?.count ?? 0) };
  }

  /** The nodes with these ids, in no particular order. */
  async nodesByIds(projectId: string, ids: readonly string[]): Promise<BrainNode[]> {
    if (ids.length === 0) return [];
    const result = await this.db.query<NodeRow>(`select ${NODE_COLUMNS} from knowledge.brain_node where project_id = $1 and id = any($2::text[])`, [projectId, [...ids]]);
    return result.rows.map(toNode);
  }

  /**
   * The nodes of a document whose own text overlaps any of the line ranges, in document order. Own ranges split a
   * document without overlap, so a change is placed on the sections and cards it touched, not on their parents.
   */
  async nodesInRanges(projectId: string, path: string, ranges: ReadonlyArray<{ start: number; end: number }>, limit: number): Promise<BrainNode[]> {
    if (ranges.length === 0) return [];
    const result = await this.db.query<NodeRow>(
      `select distinct ${NODE_COLUMNS.split(", ").map((column) => `n.${column}`).join(", ")}
         from knowledge.brain_node n
         join unnest($3::int[], $4::int[]) as r(first, last) on n.line_start <= r.last and n.line_end >= r.first
        where n.project_id = $1 and n.path = $2 and n.kind in ('document', 'section', 'card')
        order by n.line_start
        limit $5`,
      [projectId, path, ranges.map((range) => range.start), ranges.map((range) => range.end), limit],
    );
    return result.rows.map(toNode);
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

/** The home data of each node that has some, for the parts that made the tree. */
function homesOf(parts: readonly BrainDocumentPart[], nodes: readonly BrainNode[]): Map<string, BrainHome> {
  const partOf = new Map(parts.map((part) => [part.path, part]));
  const homes = new Map<string, BrainHome>();
  for (const node of nodes) {
    const part = partOf.get(node.path);
    const home = part === undefined ? null : brainHomeOf(part, node);
    if (home !== null) homes.set(node.id, home);
  }
  return homes;
}

/** JSON with the keys of every object in order, so two values are the same text when they hold the same data. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

interface RefRow {
  path: string;
  ordinal: number;
  from_id: string;
  kind: "link" | "id";
  target_path: string | null;
  target_anchor: string | null;
  target_id: string | null;
}

const toRef = (row: RefRow): BrainRefRow => ({
  path: row.path,
  ordinal: row.ordinal,
  fromId: row.from_id,
  kind: row.kind,
  targetPath: row.target_path,
  targetAnchor: row.target_anchor,
  targetId: row.target_id,
});

/** A node with more links than are stored keeps how many it has (P-036). */
async function setLinkTotals(client: PoolClient, projectId: string, nodes: readonly BrainNode[], linkTotals: Readonly<Record<string, number>>): Promise<void> {
  const totals = nodes.flatMap((node) => (linkTotals[node.id] === undefined ? [] : [[node.id, linkTotals[node.id] as number] as const]));
  if (totals.length === 0) return;
  await client.query(
    `update knowledge.brain_node n set outgoing_links = t.total
       from unnest($2::text[], $3::int[]) as t(id, total)
      where n.project_id = $1 and n.id = t.id`,
    [projectId, totals.map(([id]) => id), totals.map(([, total]) => total)],
  );
}

async function insertRefs(client: PoolClient, projectId: string, refs: readonly BrainRefRow[]): Promise<void> {
  for (let start = 0; start < refs.length; start += INSERT_CHUNK) {
    const chunk = refs.slice(start, start + INSERT_CHUNK);
    await client.query(
      `insert into knowledge.brain_ref (project_id, path, ordinal, from_id, kind, target_path, target_anchor, target_id)
       select $1, path, ordinal, from_id, kind, target_path, target_anchor, target_id
         from unnest($2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[])
           as t(path, ordinal, from_id, kind, target_path, target_anchor, target_id)`,
      [
        projectId,
        chunk.map((ref) => ref.path),
        chunk.map((ref) => ref.ordinal),
        chunk.map((ref) => ref.fromId),
        chunk.map((ref) => ref.kind),
        chunk.map((ref) => ref.targetPath),
        chunk.map((ref) => ref.targetAnchor),
        chunk.map((ref) => ref.targetId),
      ],
    );
  }
}

async function insertNodes(client: PoolClient, projectId: string, nodes: readonly BrainNode[], homes: ReadonlyMap<string, BrainHome>): Promise<void> {
  for (let start = 0; start < nodes.length; start += INSERT_CHUNK) {
    const chunk = nodes.slice(start, start + INSERT_CHUNK);
    const column = <T>(pick: (node: BrainNode) => T): T[] => chunk.map(pick);
    await client.query(
      `insert into knowledge.brain_node (project_id, ${NODE_COLUMNS}, home)
       select $1, id, parent_id, kind, path, anchor, title, summary, summary_source, ordinal, depth, line_start, line_end, subtree_end,
              tokens, subtree_tokens, children, case when ids = '' then '{}'::text[] else string_to_array(ids, ' ') end,
              case when labels = '' then '{}'::text[] else string_to_array(labels, ' ') end, status, owner, template, space,
              changed_commit, changed_at, changed_subject, home::jsonb
         from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::int[], $11::int[],
                     $12::int[], $13::int[], $14::int[], $15::int[], $16::bigint[], $17::int[], $18::text[], $19::text[], $20::text[], $21::text[], $22::boolean[], $23::text[],
                     $24::text[], $25::timestamptz[], $26::text[], $27::text[])
           as t(id, parent_id, kind, path, anchor, title, summary, summary_source, ordinal, depth, line_start, line_end, subtree_end,
                tokens, subtree_tokens, children, ids, labels, status, owner, template, space, changed_commit, changed_at, changed_subject, home)`,
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
        // Labels hold only `a-z`, `0-9` and `-` (brainLabels), so a space joins them safely, as it does the ids.
        column((node) => node.labels.join(" ")),
        column((node) => node.status),
        column((node) => node.owner),
        column((node) => node.template),
        column((node) => node.space),
        column((node) => node.changed?.commit ?? null),
        column((node) => node.changed?.at ?? null),
        column((node) => node.changed?.subject ?? null),
        column((node) => (homes.has(node.id) ? JSON.stringify(homes.get(node.id)) : null)),
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
