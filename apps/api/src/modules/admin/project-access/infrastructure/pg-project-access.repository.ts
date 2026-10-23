// Postgres adapter for explicit Project Access grants (schema: admin).

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool } from "#common/db/pool.js";
import { ProjectAccessRepository, type ProjectAccessGrant, type ReadableProject } from "../domain/project-access.repository.js";

interface GrantRow {
  project_id: string;
  user_id: string;
  granted_at: Date;
  granted_by: string | null;
}

@Injectable()
export class PgProjectAccessRepository extends ProjectAccessRepository {
  get #pool(): Pool {
    return getPool();
  }

  async list(projectId: string): Promise<ProjectAccessGrant[]> {
    const result = await this.#pool.query<GrantRow>(
      "select project_id, user_id, granted_at, granted_by from admin.project_access where project_id = $1 order by user_id",
      [projectId],
    );
    return result.rows.map((row) => ({
      projectId: row.project_id,
      userId: row.user_id,
      grantedAt: row.granted_at.toISOString(),
      ...(row.granted_by === null ? {} : { grantedBy: row.granted_by }),
    }));
  }

  async listReadableProjects(userId: string, projectIds: readonly string[]): Promise<ReadableProject[]> {
    if (projectIds.length === 0) return [];
    const result = await this.#pool.query<{ project_id: string; name: string }>(
      "select p.id as project_id, p.name from admin.project p " +
        "join admin.project_access a on a.project_id = p.id " +
        "where a.user_id = $1 and p.id = any($2::text[]) order by p.id",
      [userId, [...projectIds]],
    );
    return result.rows.map((row) => ({ projectId: row.project_id, name: row.name }));
  }

  async has(userId: string, projectId: string): Promise<boolean> {
    const result = await this.#pool.query(
      "select 1 from admin.project_access where user_id = $1 and project_id = $2",
      [userId, projectId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async projectExists(projectId: string): Promise<boolean> {
    const result = await this.#pool.query("select 1 from admin.project where id = $1", [projectId]);
    return (result.rowCount ?? 0) > 0;
  }

  async userExists(userId: string): Promise<boolean> {
    const result = await this.#pool.query("select 1 from core.app_user where id = $1", [userId]);
    return (result.rowCount ?? 0) > 0;
  }

  async grant(projectId: string, userId: string, actorId: string): Promise<boolean> {
    const result = await this.#pool.query(
      "insert into admin.project_access (project_id, user_id, granted_by) values ($1, $2, $3) on conflict (project_id, user_id) do nothing",
      [projectId, userId, actorId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revoke(projectId: string, userId: string): Promise<boolean> {
    const result = await this.#pool.query("delete from admin.project_access where project_id = $1 and user_id = $2", [projectId, userId]);
    return (result.rowCount ?? 0) > 0;
  }
}
