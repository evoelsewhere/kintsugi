// Postgres adapter for the use of member plugins per project (schema: admin).

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool } from "#common/db/pool.js";
import { PluginAccessRepository, type PluginAccessGrant } from "../domain/plugin-access.repository.js";

interface GrantRow {
  project_id: string;
  plugin_name: string;
  user_id: string;
  granted_at: Date;
  granted_by: string | null;
}

@Injectable()
export class PgPluginAccessRepository extends PluginAccessRepository {
  get #pool(): Pool {
    return getPool();
  }

  async list(projectId: string): Promise<PluginAccessGrant[]> {
    const result = await this.#pool.query<GrantRow>(
      "select project_id, plugin_name, user_id, granted_at, granted_by from admin.plugin_access where project_id = $1 order by plugin_name, user_id",
      [projectId],
    );
    return result.rows.map((row) => ({
      projectId: row.project_id,
      pluginName: row.plugin_name,
      userId: row.user_id,
      grantedAt: row.granted_at.toISOString(),
      ...(row.granted_by === null ? {} : { grantedBy: row.granted_by }),
    }));
  }

  async pluginsFor(userId: string, projectId: string): Promise<string[]> {
    const result = await this.#pool.query<{ plugin_name: string }>(
      "select distinct plugin_name from admin.plugin_access where project_id = $1 and user_id in ($2, '*') order by plugin_name",
      [projectId, userId],
    );
    return result.rows.map((row) => row.plugin_name);
  }

  async projectExists(projectId: string): Promise<boolean> {
    return ((await this.#pool.query("select 1 from admin.project where id = $1", [projectId])).rowCount ?? 0) > 0;
  }

  async userExists(userId: string): Promise<boolean> {
    return ((await this.#pool.query("select 1 from core.app_user where id = $1", [userId])).rowCount ?? 0) > 0;
  }

  async grant(projectId: string, pluginName: string, userId: string, actorId: string): Promise<boolean> {
    const result = await this.#pool.query(
      "insert into admin.plugin_access (project_id, plugin_name, user_id, granted_by) values ($1, $2, $3, $4) on conflict do nothing",
      [projectId, pluginName, userId, actorId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revoke(projectId: string, pluginName: string, userId: string): Promise<boolean> {
    const result = await this.#pool.query(
      "delete from admin.plugin_access where project_id = $1 and plugin_name = $2 and user_id = $3",
      [projectId, pluginName, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
