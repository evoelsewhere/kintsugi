// Drafts and their attachments in Postgres (knowledge.wiki_draft, knowledge.wiki_draft_attachment).

import { Injectable } from "@nestjs/common";
import { getPool } from "#common/db/pool.js";
import type { NewWikiDraft, WikiAttachment, WikiDraft, WikiPresence } from "../domain/wiki.js";
import { WikiAttachments, WikiDrafts } from "../domain/wiki.ports.js";

interface DraftRow {
  id: string;
  project_id: string;
  user_id: string;
  page_path: string;
  page_id: string | null;
  text: string;
  base_commit: string | null;
  base_hash: string | null;
  revision: number;
  write_id: string | null;
  touched_at: Date;
}

const COLUMNS = "id, project_id, user_id, page_path, page_id, text, base_commit, base_hash, revision, write_id, touched_at";

const toDraft = (row: DraftRow): WikiDraft => ({
  id: row.id,
  projectId: row.project_id,
  userId: row.user_id,
  path: row.page_path,
  pageId: row.page_id,
  text: row.text,
  baseCommit: row.base_commit,
  baseHash: row.base_hash,
  revision: row.revision,
  writeId: row.write_id,
  touchedAt: row.touched_at.toISOString(),
});

@Injectable()
export class PgWikiDrafts extends WikiDrafts {
  async find(projectId: string, userId: string, path: string): Promise<WikiDraft | undefined> {
    const result = await getPool().query<DraftRow>(`select ${COLUMNS} from knowledge.wiki_draft where project_id = $1 and user_id = $2 and page_path = $3`, [projectId, userId, path]);
    return result.rows[0] === undefined ? undefined : toDraft(result.rows[0]);
  }

  async create(draft: NewWikiDraft): Promise<WikiDraft> {
    const result = await getPool().query<DraftRow>(
      `insert into knowledge.wiki_draft (project_id, user_id, page_path, page_id, text, base_commit, base_hash)
       values ($1, $2, $3, $4, $5, $6, $7) returning ${COLUMNS}`,
      [draft.projectId, draft.userId, draft.path, draft.pageId, draft.text, draft.baseCommit, draft.baseHash],
    );
    return toDraft(result.rows[0]!);
  }

  async update(id: string, baseRevision: number, text: string): Promise<WikiDraft | undefined> {
    const result = await getPool().query<DraftRow>(
      `update knowledge.wiki_draft set write_id = case when knowledge.wiki_draft.text = $3 then knowledge.wiki_draft.write_id else null end, text = $3, revision = revision + 1, touched_at = now()
        where id = $1 and revision = $2 returning ${COLUMNS}`,
      [id, baseRevision, text],
    );
    return result.rows[0] === undefined ? undefined : toDraft(result.rows[0]);
  }

  async setWrite(id: string, writeId: string | null): Promise<void> {
    await getPool().query("update knowledge.wiki_draft set write_id = $2 where id = $1", [id, writeId]);
  }

  async remove(id: string): Promise<boolean> {
    return ((await getPool().query("delete from knowledge.wiki_draft where id = $1", [id])).rowCount ?? 0) > 0;
  }

  async listOf(projectId: string, userId: string): Promise<WikiDraft[]> {
    const result = await getPool().query<DraftRow>(`select ${COLUMNS} from knowledge.wiki_draft where project_id = $1 and user_id = $2 order by touched_at desc, page_path`, [projectId, userId]);
    return result.rows.map(toDraft);
  }

  async othersOn(projectId: string, path: string, exceptUserId: string, since: string): Promise<WikiPresence[]> {
    const result = await getPool().query<{ user_id: string; name: string; touched_at: Date }>(
      `select d.user_id, coalesce(nullif(u.display_name, ''), u.username) as name, d.touched_at
         from knowledge.wiki_draft d
         join core.app_user u on u.id = d.user_id
         join admin.project_access a on a.project_id = d.project_id and a.user_id = d.user_id
        where d.project_id = $1 and d.page_path = $2 and d.user_id <> $3 and d.touched_at >= $4
        order by d.touched_at desc, d.user_id`,
      [projectId, path, exceptUserId, since],
    );
    return result.rows.map((row) => ({ userId: row.user_id, name: row.name, touchedAt: row.touched_at.toISOString() }));
  }
}

@Injectable()
export class PgWikiAttachments extends WikiAttachments {
  async put(draftId: string, file: { name: string; contentType: string; bytes: Buffer }): Promise<WikiAttachment> {
    await getPool().query(
      `insert into knowledge.wiki_draft_attachment (draft_id, name, content_type, bytes, size) values ($1, $2, $3, $4, $5)
       on conflict (draft_id, name) do update set content_type = excluded.content_type, bytes = excluded.bytes, size = excluded.size`,
      [draftId, file.name, file.contentType, file.bytes, file.bytes.length],
    );
    return { name: file.name, contentType: file.contentType, size: file.bytes.length };
  }

  async list(draftId: string): Promise<WikiAttachment[]> {
    const result = await getPool().query<{ name: string; content_type: string; size: number }>("select name, content_type, size from knowledge.wiki_draft_attachment where draft_id = $1 order by name", [draftId]);
    return result.rows.map((row) => ({ name: row.name, contentType: row.content_type, size: row.size }));
  }

  async read(draftId: string, name: string): Promise<{ contentType: string; bytes: Buffer } | undefined> {
    const result = await getPool().query<{ content_type: string; bytes: Buffer }>("select content_type, bytes from knowledge.wiki_draft_attachment where draft_id = $1 and name = $2", [draftId, name]);
    const row = result.rows[0];
    return row === undefined ? undefined : { contentType: row.content_type, bytes: row.bytes };
  }

  async remove(draftId: string, name: string): Promise<boolean> {
    return ((await getPool().query("delete from knowledge.wiki_draft_attachment where draft_id = $1 and name = $2", [draftId, name])).rowCount ?? 0) > 0;
  }
}
