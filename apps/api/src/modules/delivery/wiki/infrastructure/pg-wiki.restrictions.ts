// The edit restrictions of a project in Postgres (knowledge.wiki_restriction).

import { Injectable } from "@nestjs/common";
import { getPool } from "#common/db/pool.js";
import type { WikiRestriction, WikiRestrictionKind, WikiSubjectKind } from "../domain/wiki.js";
import { WikiRestrictions } from "../domain/wiki.ports.js";

interface RestrictionRow {
  id: string;
  project_id: string;
  path_prefix: string;
  subject_kind: WikiSubjectKind;
  subject_id: string;
  kind: WikiRestrictionKind;
  created_by: string | null;
  created_at: Date;
}

const COLUMNS = "id, project_id, path_prefix, subject_kind, subject_id, kind, created_by, created_at";

const toRestriction = (row: RestrictionRow): WikiRestriction => ({
  id: row.id,
  projectId: row.project_id,
  pathPrefix: row.path_prefix,
  subjectKind: row.subject_kind,
  subjectId: row.subject_id,
  kind: row.kind,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

@Injectable()
export class PgWikiRestrictions extends WikiRestrictions {
  async list(projectId: string): Promise<WikiRestriction[]> {
    const result = await getPool().query<RestrictionRow>(`select ${COLUMNS} from knowledge.wiki_restriction where project_id = $1 order by path_prefix, kind, subject_kind, subject_id`, [projectId]);
    return result.rows.map(toRestriction);
  }

  async covering(projectId: string, path: string): Promise<WikiRestriction[]> {
    // A prefix covers the path when it is the path, or a folder ("…/") the path is under; starts_with has no wildcards to escape.
    const result = await getPool().query<RestrictionRow>(
      `select ${COLUMNS} from knowledge.wiki_restriction
        where project_id = $1 and (path_prefix = $2 or (right(path_prefix, 1) = '/' and starts_with($2, path_prefix)))
        order by path_prefix, kind, subject_kind, subject_id`,
      [projectId, path],
    );
    return result.rows.map(toRestriction);
  }

  async add(input: { projectId: string; pathPrefix: string; subjectKind: WikiSubjectKind; subjectId: string; kind: WikiRestrictionKind; createdBy: string | null }): Promise<WikiRestriction> {
    // Updating a column to its own value returns the row that was there, so the same restriction again is a no-op with an answer.
    const result = await getPool().query<RestrictionRow>(
      `insert into knowledge.wiki_restriction (project_id, path_prefix, subject_kind, subject_id, kind, created_by) values ($1, $2, $3, $4, $5, $6)
       on conflict (project_id, path_prefix, subject_kind, subject_id, kind) do update set kind = excluded.kind returning ${COLUMNS}`,
      [input.projectId, input.pathPrefix, input.subjectKind, input.subjectId, input.kind, input.createdBy],
    );
    return toRestriction(result.rows[0]!);
  }

  async clear(projectId: string, pathPrefix: string, kind: WikiRestrictionKind): Promise<number> {
    return (await getPool().query("delete from knowledge.wiki_restriction where project_id = $1 and path_prefix = $2 and kind = $3", [projectId, pathPrefix, kind])).rowCount ?? 0;
  }
}
