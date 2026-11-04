// Comments of wiki pages in Postgres (knowledge.wiki_comment); the author's names come from core.app_user.

import { Injectable } from "@nestjs/common";
import { getPool, withTransaction } from "#common/db/pool.js";
import { COMMENTS_OPEN_MAX, COMMENT_DUPLICATE_WINDOW_SECONDS, type NewWikiComment, type WikiCommentAnchor, type WikiCommentRow } from "../domain/wiki.comment.js";
import { WikiComments } from "../domain/wiki.ports.js";

interface CommentRow {
  id: string;
  project_id: string;
  page_key: string;
  path_at_write: string;
  parent_id: string | null;
  author_id: string;
  body: string;
  anchor: WikiCommentAnchor | null;
  status: "open" | "resolved";
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
  username: string;
  display_name: string;
}

/** The columns of a comment with the names of its author. */
const SELECT = `select c.id, c.project_id, c.page_key, c.path_at_write, c.parent_id, c.author_id, c.body, c.anchor, c.status, c.resolved_by, c.resolved_at, c.created_at, c.edited_at, c.deleted_at,
       u.username, coalesce(nullif(u.display_name, ''), u.username) as display_name
  from knowledge.wiki_comment c join core.app_user u on u.id = c.author_id`;

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

const toRow = (row: CommentRow): WikiCommentRow => ({
  id: row.id,
  projectId: row.project_id,
  pageKey: row.page_key,
  pathAtWrite: row.path_at_write,
  parentId: row.parent_id,
  authorId: row.author_id,
  body: row.body,
  anchor: row.anchor,
  status: row.status,
  resolvedBy: row.resolved_by,
  resolvedAt: iso(row.resolved_at),
  createdAt: row.created_at.toISOString(),
  editedAt: iso(row.edited_at),
  deletedAt: iso(row.deleted_at),
  author: { id: row.author_id, username: row.username, displayName: row.display_name },
});

@Injectable()
export class PgWikiComments extends WikiComments {
  async createOnce(comment: NewWikiComment): Promise<{ comment: WikiCommentRow; duplicate: boolean } | { tooMany: true }> {
    // A page's comments are written one at a time, so the count of open ones and the look for a double click cannot race.
    return withTransaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify(["wiki-comment", comment.projectId, comment.pageKey])]);
      const twin = await tx.query<CommentRow>(
        `${SELECT} where c.project_id = $1 and c.page_key = $2 and c.author_id = $3 and c.body = $4 and c.parent_id is not distinct from $5
            and c.deleted_at is null and c.created_at > now() - make_interval(secs => $6) order by c.created_at limit 1`,
        [comment.projectId, comment.pageKey, comment.authorId, comment.body, comment.parentId, COMMENT_DUPLICATE_WINDOW_SECONDS],
      );
      if (twin.rows[0] !== undefined) return { comment: toRow(twin.rows[0]), duplicate: true };
      const open = await tx.query<{ n: number }>("select count(*)::int as n from knowledge.wiki_comment where project_id = $1 and page_key = $2 and status = 'open' and deleted_at is null", [comment.projectId, comment.pageKey]);
      if ((open.rows[0]?.n ?? 0) >= COMMENTS_OPEN_MAX) return { tooMany: true };
      const inserted = await tx.query<{ id: string }>(
        `insert into knowledge.wiki_comment (project_id, page_key, path_at_write, parent_id, author_id, body, anchor) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [comment.projectId, comment.pageKey, comment.pathAtWrite, comment.parentId, comment.authorId, comment.body, comment.anchor === null ? null : JSON.stringify(comment.anchor)],
      );
      const stored = await tx.query<CommentRow>(`${SELECT} where c.id = $1`, [inserted.rows[0]!.id]);
      return { comment: toRow(stored.rows[0]!), duplicate: false };
    });
  }

  async find(projectId: string, id: string): Promise<WikiCommentRow | undefined> {
    // An id that is not a uuid is no comment (the query would raise).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined;
    const result = await getPool().query<CommentRow>(`${SELECT} where c.project_id = $1 and c.id = $2`, [projectId, id]);
    return result.rows[0] === undefined ? undefined : toRow(result.rows[0]);
  }

  async setStatus(projectId: string, id: string, status: "open" | "resolved", userId: string): Promise<WikiCommentRow | { tooMany: true } | undefined> {
    return withTransaction(async (tx) => {
      const current = await tx.query<{ page_key: string; status: string }>("select page_key, status from knowledge.wiki_comment where project_id = $1 and id = $2 and deleted_at is null", [projectId, id]);
      const found = current.rows[0];
      if (found === undefined) return undefined;
      // Reopening takes a place among the open ones, so it is counted like a new comment, one page at a time.
      await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify(["wiki-comment", projectId, found.page_key])]);
      if (status === "open" && found.status !== "open") {
        const open = await tx.query<{ n: number }>("select count(*)::int as n from knowledge.wiki_comment where project_id = $1 and page_key = $2 and status = 'open' and deleted_at is null", [projectId, found.page_key]);
        if ((open.rows[0]?.n ?? 0) >= COMMENTS_OPEN_MAX) return { tooMany: true };
      }
      if (status === "resolved") await tx.query("update knowledge.wiki_comment set status = 'resolved', resolved_by = $3, resolved_at = now() where project_id = $1 and id = $2", [projectId, id, userId]);
      else await tx.query("update knowledge.wiki_comment set status = 'open', resolved_by = null, resolved_at = null where project_id = $1 and id = $2", [projectId, id]);
      return toRow((await tx.query<CommentRow>(`${SELECT} where c.id = $1`, [id])).rows[0]!);
    });
  }

  async edit(projectId: string, id: string, body: string): Promise<WikiCommentRow | undefined> {
    const updated = await getPool().query("update knowledge.wiki_comment set body = $3, edited_at = now() where project_id = $1 and id = $2 and deleted_at is null", [projectId, id, body]);
    return (updated.rowCount ?? 0) === 0 ? undefined : this.find(projectId, id);
  }

  async hasReplies(projectId: string, id: string): Promise<boolean> {
    return ((await getPool().query("select 1 from knowledge.wiki_comment where project_id = $1 and parent_id = $2 and deleted_at is null limit 1", [projectId, id])).rowCount ?? 0) > 0;
  }

  async remove(projectId: string, id: string): Promise<boolean> {
    return ((await getPool().query("update knowledge.wiki_comment set deleted_at = now(), body = '' where project_id = $1 and id = $2 and deleted_at is null", [projectId, id])).rowCount ?? 0) > 0;
  }

  async listOfPage(projectId: string, pageKey: string, limit: number, after: string | undefined): Promise<{ rows: WikiCommentRow[]; next: string | null }> {
    const result = await getPool().query<CommentRow>(
      `${SELECT} where c.project_id = $1 and c.page_key = $2
          and (c.deleted_at is null or exists (select 1 from knowledge.wiki_comment r where r.parent_id = c.id and r.deleted_at is null))
          and ($3::uuid is null or (c.created_at, c.id) > (select a.created_at, a.id from knowledge.wiki_comment a where a.id = $3))
        order by c.created_at, c.id limit $4`,
      [projectId, pageKey, after ?? null, limit + 1],
    );
    const rows = result.rows.slice(0, limit).map(toRow);
    return { rows, next: result.rows.length > limit ? rows[rows.length - 1]!.id : null };
  }
}
