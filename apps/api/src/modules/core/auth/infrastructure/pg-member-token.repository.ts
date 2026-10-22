// Postgres adapter for member tokens (schema: core). Only SHA-256 hashes are stored.

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool, withTransaction } from "#common/db/pool.js";
import { MemberTokenRepository, type MemberTokenMetadata, type MemberTokenRecordInput } from "../domain/member-token.repository.js";

interface MetadataRow {
  id: string;
  name: string;
  project_ids: string[];
  created_at: Date;
  expires_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

function toMetadata(row: MetadataRow): MemberTokenMetadata {
  return {
    id: row.id,
    name: row.name,
    projectIds: row.project_ids,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    ...(row.last_used_at === null ? {} : { lastUsedAt: row.last_used_at.toISOString() }),
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at.toISOString() }),
  };
}

const METADATA_QUERY = `
  select mt.id, mt.name,
         coalesce(array_agg(mtp.project_id order by mtp.project_id) filter (where mtp.project_id is not null), '{}'::text[]) as project_ids,
         mt.created_at, mt.expires_at, mt.last_used_at, mt.revoked_at
  from core.member_token mt
  left join core.member_token_project mtp on mtp.token_id = mt.id`;

@Injectable()
export class PgMemberTokenRepository extends MemberTokenRepository {
  get #pool(): Pool {
    return getPool();
  }

  async create(input: MemberTokenRecordInput): Promise<MemberTokenMetadata> {
    return withTransaction(async (client) => {
      await client.query(
        "insert into core.member_token (id, user_id, name, token_hash, expires_at, connection_id) values ($1, $2, $3, $4, $5, $6)",
        [input.id, input.userId, input.name, input.tokenHash, input.expiresAt, input.connectionId ?? null],
      );
      await client.query(
        "insert into core.member_token_project (token_id, project_id) select $1, project_id from unnest($2::text[]) as project_id",
        [input.id, input.projectIds],
      );
      const result = await client.query<MetadataRow>(`${METADATA_QUERY} where mt.id = $1 group by mt.id`, [input.id]);
      const row = result.rows[0];
      if (row === undefined) throw new Error("Created member token was not readable");
      return toMetadata(row);
    });
  }

  async listByUser(userId: string): Promise<MemberTokenMetadata[]> {
    const result = await this.#pool.query<MetadataRow>(`${METADATA_QUERY} where mt.user_id = $1 and mt.connection_id is null group by mt.id order by mt.created_at desc`, [userId]);
    return result.rows.map(toMetadata);
  }

  async revoke(userId: string, tokenId: string): Promise<boolean> {
    const result = await this.#pool.query(
      "update core.member_token set revoked_at = now() where id = $1 and user_id = $2 and connection_id is null and revoked_at is null",
      [tokenId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async authenticate(tokenHash: string, maxConnectionAgeDays?: 15 | 30): Promise<{ tokenId: string; userId: string; projectIds: string[]; connectionId?: string } | undefined> {
    const result = await this.#pool.query<{ token_id: string; user_id: string; project_ids: string[]; connection_id: string | null }>(
      `with active_token as (
         update core.member_token mt set last_used_at = now()
         from core.app_user u
         where mt.user_id = u.id and u.enabled = true and mt.token_hash = $1
           and mt.revoked_at is null and mt.expires_at > now()
           and (
             mt.connection_id is null
             or exists (
               select 1 from core.member_connection c
               where c.id = mt.connection_id and c.revoked_at is null
                 and $2::integer is not null
                 and c.created_at + ($2::integer * interval '1 day') > now()
             )
           )
         returning mt.id, mt.user_id, mt.connection_id
       )
       select active_token.id as token_id, active_token.user_id, active_token.connection_id,
              coalesce(array_agg(mtp.project_id order by mtp.project_id)
                filter (where pa.project_id is not null and (active_token.connection_id is null or cp.project_id is not null)), '{}'::text[]) as project_ids
       from active_token
       left join core.member_token_project mtp on mtp.token_id = active_token.id
       left join admin.project_access pa on pa.project_id = mtp.project_id and pa.user_id = active_token.user_id
       left join core.member_connection_project cp on cp.connection_id = active_token.connection_id and cp.project_id = mtp.project_id
       group by active_token.id, active_token.user_id, active_token.connection_id`,
      [tokenHash, maxConnectionAgeDays ?? null],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          tokenId: row.token_id,
          userId: row.user_id,
          projectIds: row.project_ids,
          ...(row.connection_id === null ? {} : { connectionId: row.connection_id }),
        };
  }
}
