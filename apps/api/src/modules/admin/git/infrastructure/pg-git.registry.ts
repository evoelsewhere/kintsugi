// Postgres adapter for Git servers and repositories (ADR-0010; schema: admin).
// Server credentials live in admin.git_secret as AES-256-GCM ciphertext; plaintext
// leaves this adapter only through serverAccess(), for one Git call.

import { Injectable } from "@nestjs/common";
import type { GitServerKind } from "@kintsugi/domain";
import type { Pool } from "pg";
import { getPool, type Queryable, withTransaction } from "#common/db/pool.js";
import { readSecret, type SecretTable, secretExists, storeSecret } from "#common/db/secret-store.js";
import type {
  GitAccess,
  GitAuthType,
  GitRepositoryRecord,
  GitServerCredential,
  GitServerRecord,
  RegisterGitRepository,
  RegisterGitServer,
  SyncStatus,
} from "../domain/git.js";
import { RepositoryInUseError } from "../domain/git.js";
import { GitRegistry } from "../domain/git.ports.js";

const SECRETS: SecretTable = { table: "admin.git_secret", ownerColumn: "server_id" };
const tokenSecretId = (serverId: string): string => `git-server:${serverId}:token`;
const keySecretId = (serverId: string): string => `git-server:${serverId}:ssh-key`;
const githubAppKeySecretId = (serverId: string): string => `git-server:${serverId}:github-app-private-key`;

interface ServerRow {
  id: string;
  kind: GitServerKind;
  name: string;
  base_url: string;
  auth_type: GitAuthType;
  username: string | null;
  known_hosts: string | null;
  github_app_id: string | null;
  github_installation_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface RepositoryRow {
  id: string;
  server_id: string;
  url: string;
  default_branch: string | null;
  sync_status: SyncStatus;
  last_commit: string | null;
  last_synced_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

const SERVER_COLUMNS = "id, kind, name, base_url, auth_type, username, known_hosts, github_app_id, github_installation_id, created_at, updated_at";
const REPOSITORY_COLUMNS = "id, server_id, url, default_branch, sync_status, last_commit, last_synced_at, last_error, created_at, updated_at";

@Injectable()
export class PgGitRegistry extends GitRegistry {
  get #pool(): Pool {
    return getPool();
  }

  async listServers(): Promise<GitServerRecord[]> {
    const result = await this.#pool.query<ServerRow>(`select ${SERVER_COLUMNS} from admin.git_server order by id`);
    return Promise.all(result.rows.map((row) => this.#toServer(row)));
  }

  async getServer(id: string): Promise<GitServerRecord | undefined> {
    const result = await this.#pool.query<ServerRow>(`select ${SERVER_COLUMNS} from admin.git_server where id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : this.#toServer(row);
  }

  async createServer(input: RegisterGitServer): Promise<GitServerRecord> {
    await withTransaction(async (client) => {
      await client.query(
        `insert into admin.git_server (id, kind, name, base_url, auth_type, username, known_hosts, github_app_id, github_installation_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [input.id, input.kind, input.name, input.baseUrl, input.authType, input.username ?? null, input.knownHosts ?? null, input.githubApp?.appId ?? null, input.githubApp?.installationId ?? null],
      );
      await this.#storeCredential(client, input.id, input.authType, input.credential);
      if (input.githubApp !== undefined && input.githubApp !== null) {
        await storeSecret(client, SECRETS, input.id, githubAppKeySecretId(input.id), input.githubApp.privateKey);
      }
    });
    return (await this.getServer(input.id))!;
  }

  async replaceServer(id: string, input: RegisterGitServer): Promise<GitServerRecord | undefined> {
    const fresh = input.credential.token !== undefined || input.credential.privateKey !== undefined;
    const updated = await withTransaction(async (client) => {
      const result = await client.query(
        `update admin.git_server set kind = $2, name = $3, base_url = $4, auth_type = $5, username = $6, known_hosts = $7,
           github_app_id = case when $8 then $9 else github_app_id end,
           github_installation_id = case when $8 then $10 else github_installation_id end,
           updated_at = now()
         where id = $1`,
        [
          id,
          input.kind,
          input.name,
          input.baseUrl,
          input.authType,
          input.username ?? null,
          input.knownHosts ?? null,
          input.githubApp !== undefined,
          input.githubApp === undefined || input.githubApp === null ? null : input.githubApp.appId,
          input.githubApp === undefined || input.githubApp === null ? null : input.githubApp.installationId,
        ],
      );
      if ((result.rowCount ?? 0) === 0) return false;
      // Git clone credentials and the independent App key share the encrypted table;
      // replacing one credential family must not erase the other.
      if (fresh || input.authType === "none") {
        await client.query("delete from admin.git_secret where server_id = $1 and secret_id = any($2::text[])", [id, [tokenSecretId(id), keySecretId(id)]]);
      }
      if (fresh) await this.#storeCredential(client, id, input.authType, input.credential);
      if (input.githubApp === null) {
        await client.query("delete from admin.git_secret where server_id = $1 and secret_id = $2", [id, githubAppKeySecretId(id)]);
      } else if (input.githubApp !== undefined) {
        await storeSecret(client, SECRETS, id, githubAppKeySecretId(id), input.githubApp.privateKey);
      }
      return true;
    });
    return updated ? this.getServer(id) : undefined;
  }

  async removeServer(id: string): Promise<boolean> {
    const result = await this.#pool.query("delete from admin.git_server where id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async serverAccess(id: string): Promise<GitAccess | undefined> {
    const server = await this.getServer(id);
    if (server === undefined) return undefined;
    const token = server.authType === "token" ? await readSecret(this.#pool, SECRETS, tokenSecretId(id)) : undefined;
    const privateKey = server.authType === "ssh-key" ? await readSecret(this.#pool, SECRETS, keySecretId(id)) : undefined;
    return {
      authType: server.authType,
      ...(server.username === undefined ? {} : { username: server.username }),
      ...(token === undefined ? {} : { token }),
      ...(privateKey === undefined ? {} : { privateKey }),
      ...(server.knownHosts === undefined ? {} : { knownHosts: server.knownHosts }),
    };
  }

  async listRepositories(): Promise<GitRepositoryRecord[]> {
    const result = await this.#pool.query<RepositoryRow>(`select ${REPOSITORY_COLUMNS} from admin.git_repository order by id`);
    return result.rows.map(toRepository);
  }

  async getRepository(id: string): Promise<GitRepositoryRecord | undefined> {
    const result = await this.#pool.query<RepositoryRow>(`select ${REPOSITORY_COLUMNS} from admin.git_repository where id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : toRepository(row);
  }

  async findRepositoryByUrl(url: string): Promise<GitRepositoryRecord | undefined> {
    const result = await this.#pool.query<RepositoryRow>(`select ${REPOSITORY_COLUMNS} from admin.git_repository where url = $1`, [url]);
    const row = result.rows[0];
    return row === undefined ? undefined : toRepository(row);
  }

  async countRepositories(serverId: string): Promise<number> {
    const result = await this.#pool.query<{ count: string }>("select count(*) from admin.git_repository where server_id = $1", [serverId]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async createRepository(input: RegisterGitRepository): Promise<GitRepositoryRecord> {
    await this.#pool.query("insert into admin.git_repository (id, server_id, url, default_branch) values ($1, $2, $3, $4)", [
      input.id,
      input.serverId,
      input.url,
      input.defaultBranch ?? null,
    ]);
    return (await this.getRepository(input.id))!;
  }

  async removeRepository(id: string): Promise<boolean> {
    try {
      const result = await this.#pool.query("delete from admin.git_repository where id = $1", [id]);
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      // admin.project_repository references the repository (on delete restrict).
      if ((error as { code?: string }).code === "23503") throw new RepositoryInUseError(`Repository ${id} is linked to a project; unlink it there first`);
      throw error;
    }
  }

  async #storeCredential(db: Queryable, serverId: string, authType: GitAuthType, credential: GitServerCredential): Promise<void> {
    if (authType === "token" && credential.token !== undefined) await storeSecret(db, SECRETS, serverId, tokenSecretId(serverId), credential.token);
    if (authType === "ssh-key" && credential.privateKey !== undefined) {
      await storeSecret(db, SECRETS, serverId, keySecretId(serverId), credential.privateKey);
    }
  }

  async #toServer(row: ServerRow): Promise<GitServerRecord> {
    const secretId = row.auth_type === "token" ? tokenSecretId(row.id) : row.auth_type === "ssh-key" ? keySecretId(row.id) : undefined;
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      baseUrl: row.base_url,
      authType: row.auth_type,
      ...(row.username === null ? {} : { username: row.username }),
      ...(row.known_hosts === null ? {} : { knownHosts: row.known_hosts }),
      hasCredential: secretId === undefined ? false : await secretExists(this.#pool, SECRETS, secretId),
      ...(row.github_app_id === null || row.github_installation_id === null
        ? {}
        : {
            githubApp: {
              appId: row.github_app_id,
              installationId: row.github_installation_id,
              hasPrivateKey: await secretExists(this.#pool, SECRETS, githubAppKeySecretId(row.id)),
            },
          }),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

function toRepository(row: RepositoryRow): GitRepositoryRecord {
  return {
    id: row.id,
    serverId: row.server_id,
    url: row.url,
    ...(row.default_branch === null ? {} : { defaultBranch: row.default_branch }),
    syncStatus: row.sync_status,
    ...(row.last_commit === null ? {} : { lastCommit: row.last_commit }),
    ...(row.last_synced_at === null ? {} : { lastSyncedAt: row.last_synced_at.toISOString() }),
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
