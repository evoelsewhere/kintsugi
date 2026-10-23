import { Injectable } from "@nestjs/common";
import { getPool, withTransaction } from "#common/db/pool.js";
import {
  MemberConnectionRepository,
  type AuthorizationCodeInput,
  type AuthorizationCodeRecord,
  type ConnectionAuthorizationResult,
  type ExchangeAuthorizationCodeInput,
  type MemberConnectionMetadata,
  type RefreshCredentialSnapshot,
  type RotateRefreshCredentialInput,
  type RotateRefreshCredentialResult,
} from "../domain/member-connection.repository.js";

interface AuthorizationCodeRow {
  user_id: string;
  client_name: string;
  redirect_uri: string;
  code_challenge: string;
  project_ids: string[];
  expires_at: Date;
  consumed_at: Date | null;
}

interface RefreshCredentialRow {
  connection_id: string;
  user_id: string;
  client_name: string;
  project_ids: string[];
  created_at: Date;
  revoked_at: Date | null;
  consumed_at: Date | null;
}

interface ConnectionRow {
  id: string;
  user_id: string;
  client_name: string;
  created_at: Date;
  revoked_at: Date | null;
}

interface ConnectionMetadataRow {
  id: string;
  client_name: string;
  project_ids: string[];
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

function toMetadata(row: ConnectionMetadataRow): MemberConnectionMetadata {
  return {
    id: row.id,
    clientName: row.client_name,
    projectIds: row.project_ids,
    createdAt: row.created_at.toISOString(),
    ...(row.last_used_at === null ? {} : { lastUsedAt: row.last_used_at.toISOString() }),
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at.toISOString() }),
  };
}

@Injectable()
export class PgMemberConnectionRepository extends MemberConnectionRepository {
  async createAuthorizationCode(input: AuthorizationCodeInput): Promise<void> {
    await getPool().query(
      `insert into core.member_authorization_code
         (code_hash, user_id, client_name, redirect_uri, code_challenge, project_ids, expires_at)
       values ($1, $2, $3, $4, $5, $6::text[], $7)`,
      [input.codeHash, input.userId, input.clientName, input.redirectUri, input.codeChallenge, input.projectIds, input.expiresAt],
    );
  }

  async findAuthorizationCode(codeHash: string): Promise<AuthorizationCodeRecord | undefined> {
    const result = await getPool().query<AuthorizationCodeRow>(
      `select user_id, client_name, redirect_uri, code_challenge, project_ids, expires_at, consumed_at
       from core.member_authorization_code where code_hash = $1`,
      [codeHash],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          userId: row.user_id,
          clientName: row.client_name,
          redirectUri: row.redirect_uri,
          codeChallenge: row.code_challenge,
          projectIds: row.project_ids,
          expiresAt: row.expires_at,
          consumedAt: row.consumed_at,
        };
  }

  async exchangeAuthorizationCode(input: ExchangeAuthorizationCodeInput): Promise<ConnectionAuthorizationResult | undefined> {
    return withTransaction(async (client) => {
      const selected = await client.query<AuthorizationCodeRow>(
        `select user_id, client_name, redirect_uri, code_challenge, project_ids, expires_at, consumed_at
         from core.member_authorization_code where code_hash = $1 for update`,
        [input.codeHash],
      );
      const code = selected.rows[0];
      if (code === undefined || code.consumed_at !== null || code.expires_at.getTime() <= Date.now()) return undefined;

      // Any exchange attempt burns a live code, including a verifier or redirect mismatch.
      await client.query("update core.member_authorization_code set consumed_at = now() where code_hash = $1", [input.codeHash]);
      if (code.redirect_uri !== input.redirectUri || code.code_challenge !== input.verifierChallenge) return undefined;

      const connection = await client.query<ConnectionRow>(
        `insert into core.member_connection (id, user_id, client_name)
         values ($1, $2, $3)
         returning id, user_id, client_name, created_at, revoked_at`,
        [input.connectionId, code.user_id, code.client_name],
      );
      const row = connection.rows[0];
      if (row === undefined) throw new Error("Created Kintsugi member connection was not readable");
      await client.query(
        "insert into core.member_connection_project (connection_id, project_id) select $1, project_id from unnest($2::text[]) as project_id",
        [input.connectionId, code.project_ids],
      );
      await client.query(
        "insert into core.member_connection_refresh_token (token_hash, connection_id) values ($1, $2)",
        [input.refreshTokenHash, input.connectionId],
      );
      await this.#insertAccessToken(client, input.connectionId, code.user_id, code.client_name, code.project_ids, input.accessToken);
      return { connectionId: row.id, userId: row.user_id, clientName: row.client_name, projectIds: code.project_ids };
    });
  }

  async getRefreshCredential(tokenHash: string): Promise<RefreshCredentialSnapshot | undefined> {
    const result = await getPool().query<RefreshCredentialRow>(
      `select c.id as connection_id, c.user_id, c.client_name, c.created_at, c.revoked_at, rt.consumed_at,
              coalesce(array_agg(cp.project_id order by cp.project_id) filter (where cp.project_id is not null), '{}'::text[]) as project_ids
       from core.member_connection_refresh_token rt
       join core.member_connection c on c.id = rt.connection_id
       left join core.member_connection_project cp on cp.connection_id = c.id
       where rt.token_hash = $1
       group by c.id, rt.consumed_at`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          connectionId: row.connection_id,
          userId: row.user_id,
          clientName: row.client_name,
          projectIds: row.project_ids,
          createdAt: row.created_at,
          revokedAt: row.revoked_at,
          consumedAt: row.consumed_at,
        };
  }

  async rotateRefreshCredential(input: RotateRefreshCredentialInput): Promise<RotateRefreshCredentialResult> {
    return withTransaction(async (client) => {
      const tokenOwner = await client.query<{ connection_id: string }>(
        "select connection_id from core.member_connection_refresh_token where token_hash = $1",
        [input.tokenHash],
      );
      const connectionId = tokenOwner.rows[0]?.connection_id;
      if (connectionId === undefined) return { status: "invalid" };

      // Use the same lock order as revocation: connection first, then refresh-token history.
      const lockedConnection = await client.query<ConnectionRow>(
        `select id, user_id, client_name, created_at, revoked_at
         from core.member_connection where id = $1 for update`,
        [connectionId],
      );
      const connection = lockedConnection.rows[0];
      const lockedToken = await client.query<{ connection_id: string; consumed_at: Date | null }>(
        `select connection_id, consumed_at from core.member_connection_refresh_token
         where token_hash = $1 for update`,
        [input.tokenHash],
      );
      const refresh = lockedToken.rows[0];
      if (connection === undefined || refresh === undefined || refresh.connection_id !== connectionId || connection.revoked_at !== null) {
        return { status: "invalid" };
      }

      if (refresh.consumed_at !== null) {
        await this.#revokeConnection(client, connectionId, undefined);
        return { status: "replayed" };
      }
      const age = await client.query<{ expired: boolean }>(
        "select created_at + ($2::integer * interval '1 day') <= now() as expired from core.member_connection where id = $1",
        [connectionId, input.maxAgeDays],
      );
      if (age.rows[0]?.expired === true) {
        await this.#revokeConnection(client, connectionId, undefined);
        return { status: "expired" };
      }

      const projects = await client.query<{ project_id: string }>(
        "select project_id from core.member_connection_project where connection_id = $1 order by project_id",
        [connectionId],
      );
      const projectIds = projects.rows.map((project) => project.project_id);
      if (projectIds.length === 0) return { status: "invalid" };

      await client.query("update core.member_connection_refresh_token set consumed_at = now() where token_hash = $1", [input.tokenHash]);
      await client.query(
        "insert into core.member_connection_refresh_token (token_hash, connection_id) values ($1, $2)",
        [input.refreshTokenHash, connectionId],
      );
      await this.#insertAccessToken(client, connectionId, connection.user_id, connection.client_name, projectIds, input.accessToken);
      return { status: "rotated", connectionId, userId: connection.user_id, clientName: connection.client_name, projectIds };
    });
  }

  async revokeByRefreshCredential(tokenHash: string): Promise<{ connectionId: string; userId: string } | undefined> {
    return withTransaction(async (client) => {
      const credential = await client.query<{ connection_id: string; user_id: string }>(
        `select rt.connection_id, c.user_id
         from core.member_connection_refresh_token rt
         join core.member_connection c on c.id = rt.connection_id
         where rt.token_hash = $1
         for update of c`,
        [tokenHash],
      );
      const row = credential.rows[0];
      if (row === undefined) return undefined;
      const updated = await client.query<{ id: string }>(
        `update core.member_connection set revoked_at = coalesce(revoked_at, now())
         where id = $1 and revoked_at is null returning id`,
        [row.connection_id],
      );
      if (updated.rows[0] === undefined) return undefined;
      await client.query("update core.member_connection_refresh_token set consumed_at = coalesce(consumed_at, now()) where connection_id = $1", [row.connection_id]);
      await client.query("update core.member_token set revoked_at = coalesce(revoked_at, now()) where connection_id = $1", [row.connection_id]);
      return { connectionId: row.connection_id, userId: row.user_id };
    });
  }

  async listByUser(userId: string): Promise<MemberConnectionMetadata[]> {
    return this.#list("where c.user_id = $1", [userId]);
  }

  async listAll(): Promise<MemberConnectionMetadata[]> {
    return this.#list("", []);
  }

  async revokeByUser(userId: string, connectionId: string): Promise<boolean> {
    return this.#revoke(connectionId, userId);
  }

  async revokeByAdmin(actorId: string, connectionId: string): Promise<boolean> {
    return this.#revoke(connectionId, undefined, actorId);
  }

  async #list(where: string, values: unknown[]): Promise<MemberConnectionMetadata[]> {
    const result = await getPool().query<ConnectionMetadataRow>(
      `select c.id, c.client_name,
              coalesce(array_agg(distinct cp.project_id order by cp.project_id) filter (where cp.project_id is not null), '{}'::text[]) as project_ids,
              c.created_at, max(mt.last_used_at) as last_used_at, c.revoked_at
       from core.member_connection c
       left join core.member_connection_project cp on cp.connection_id = c.id
       left join core.member_token mt on mt.connection_id = c.id
       ${where}
       group by c.id
       order by c.created_at desc`,
      values,
    );
    return result.rows.map(toMetadata);
  }

  async #revoke(connectionId: string, userId?: string, actorId?: string): Promise<boolean> {
    return withTransaction(async (client) => {
      const values: unknown[] = [connectionId];
      const ownerClause = userId === undefined ? "" : " and user_id = $2";
      if (userId !== undefined) values.push(userId);
      const revokedBy = actorId ?? null;
      const updated = await client.query<{ id: string }>(
        `update core.member_connection set revoked_at = now(), revoked_by = $${values.length + 1}
         where id = $1${ownerClause} and revoked_at is null returning id`,
        [...values, revokedBy],
      );
      if (updated.rows[0] === undefined) return false;
      await client.query("update core.member_connection_refresh_token set consumed_at = coalesce(consumed_at, now()) where connection_id = $1", [connectionId]);
      await client.query("update core.member_token set revoked_at = coalesce(revoked_at, now()) where connection_id = $1", [connectionId]);
      return true;
    });
  }

  async #revokeConnection(client: import("pg").PoolClient, connectionId: string, actorId: string | undefined): Promise<void> {
    await client.query("update core.member_connection set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, $2) where id = $1", [connectionId, actorId ?? null]);
    await client.query("update core.member_connection_refresh_token set consumed_at = coalesce(consumed_at, now()) where connection_id = $1", [connectionId]);
    await client.query("update core.member_token set revoked_at = coalesce(revoked_at, now()) where connection_id = $1", [connectionId]);
  }

  async #insertAccessToken(
    client: import("pg").PoolClient,
    connectionId: string,
    userId: string,
    clientName: string,
    projectIds: string[],
    token: { id: string; tokenHash: string; expiresAt: Date },
  ): Promise<void> {
    await client.query(
      `insert into core.member_token (id, user_id, name, token_hash, expires_at, connection_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [token.id, userId, `Kintsugi member (${clientName})`, token.tokenHash, token.expiresAt, connectionId],
    );
    await client.query(
      "insert into core.member_token_project (token_id, project_id) select $1, project_id from unnest($2::text[]) as project_id",
      [token.id, projectIds],
    );
  }
}
