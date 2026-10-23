// Postgres adapter for the member activity store (schema: monitoring).

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { Page } from "#common/application/pagination.js";
import { getPool } from "#common/db/pool.js";
import type { MemberActivity, MemberActivityFilter, MemberActivityInput, MemberUsage } from "../domain/member-activity.js";
import { MemberActivityRepository } from "../domain/member-activity.repository.js";

interface ActivityRow {
  id: string;
  at: Date;
  user_id: string;
  username: string;
  project_id: string;
  plugin_name: string | null;
  harness: string | null;
  kind: string;
  summary: string;
  detail: Record<string, unknown>;
}

interface UsageRow {
  user_id: string;
  username: string;
  display_name: string;
  last_seen: Date;
  events: string;
  kinds: Record<string, number>;
  plugins: Record<string, number>;
}

@Injectable()
export class PgMemberActivityRepository extends MemberActivityRepository {
  get #pool(): Pool {
    return getPool();
  }

  async insert(id: string, input: MemberActivityInput): Promise<void> {
    await this.#pool.query(
      "insert into monitoring.member_activity (id, user_id, project_id, plugin_name, harness, kind, summary, detail) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)",
      [id, input.userId, input.projectId, input.pluginName ?? null, input.harness ?? null, input.kind, input.summary ?? "", JSON.stringify(input.detail ?? {})],
    );
  }

  async countSince(userId: string, since: Date): Promise<number> {
    const result = await this.#pool.query<{ count: string }>("select count(*) from monitoring.member_activity where user_id = $1 and at >= $2", [userId, since]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async list(filter: MemberActivityFilter): Promise<Page<MemberActivity>> {
    const where = ["a.project_id = $1"];
    const values: unknown[] = [filter.projectId];
    for (const [column, value] of [["a.user_id", filter.userId], ["a.plugin_name", filter.pluginName], ["a.kind", filter.kind]] as const) {
      if (value === undefined) continue;
      values.push(value);
      where.push(`${column} = $${values.length}`);
    }
    const condition = where.join(" and ");
    const total = await this.#pool.query<{ count: string }>(`select count(*) from monitoring.member_activity a where ${condition}`, values);
    const rows = await this.#pool.query<ActivityRow>(
      `select a.id, a.at, a.user_id, u.username, a.project_id, a.plugin_name, a.harness, a.kind, a.summary, a.detail ` +
        `from monitoring.member_activity a join core.app_user u on u.id = a.user_id where ${condition} ` +
        `order by a.at desc, a.id desc limit $${values.length + 1} offset $${values.length + 2}`,
      [...values, filter.limit, filter.offset],
    );
    return {
      items: rows.rows.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        userId: row.user_id,
        username: row.username,
        projectId: row.project_id,
        ...(row.plugin_name === null ? {} : { pluginName: row.plugin_name }),
        ...(row.harness === null ? {} : { harness: row.harness }),
        kind: row.kind,
        summary: row.summary,
        detail: row.detail,
      })),
      total: Number(total.rows[0]?.count ?? 0),
      limit: filter.limit,
      offset: filter.offset,
    };
  }

  async usage(projectId: string, from: Date, to: Date): Promise<MemberUsage[]> {
    const result = await this.#pool.query<UsageRow>(
      `with scoped as (
         select user_id, kind, plugin_name, at from monitoring.member_activity where project_id = $1 and at >= $2 and at < $3
       ), by_kind as (
         select user_id, jsonb_object_agg(kind, n) as kinds from (select user_id, kind, count(*) as n from scoped group by user_id, kind) k group by user_id
       ), by_plugin as (
         select user_id, jsonb_object_agg(plugin_name, n) as plugins from (select user_id, plugin_name, count(*) as n from scoped where plugin_name is not null group by user_id, plugin_name) p group by user_id
       )
       select u.id as user_id, u.username, u.display_name, max(s.at) as last_seen, count(*) as events,
              coalesce(k.kinds, '{}'::jsonb) as kinds, coalesce(p.plugins, '{}'::jsonb) as plugins
         from scoped s
         join core.app_user u on u.id = s.user_id
         left join by_kind k on k.user_id = s.user_id
         left join by_plugin p on p.user_id = s.user_id
        group by u.id, u.username, u.display_name, k.kinds, p.plugins
        order by max(s.at) desc`,
      [projectId, from, to],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      lastSeenAt: row.last_seen.toISOString(),
      events: Number(row.events),
      kinds: row.kinds,
      plugins: row.plugins,
    }));
  }
}
