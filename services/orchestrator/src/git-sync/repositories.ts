// Postgres access for Git sync: the registered repositories (admin.git_repository,
// owned by apps/api → modules/admin/git) and their server credential, decrypted for one
// Git call. Writes only the sync columns the API shows (sync_status, last_*).

import { decryptSecret } from "@kintsugi/secrets";
import type { GitCredential } from "@kintsugi/git";
import type { Pool } from "pg";

export type SyncStatus = "pending" | "cloning" | "ready" | "error";

/** A repository with everything needed to reach it. Holds plaintext — never log it. */
export interface SyncTarget {
  id: string;
  serverId: string;
  url: string;
  defaultBranch?: string;
  credential: GitCredential;
  knownHosts?: string;
}

interface TargetRow {
  id: string;
  server_id: string;
  url: string;
  default_branch: string | null;
  auth_type: "none" | "token" | "ssh-key";
  username: string | null;
  known_hosts: string | null;
}

const tokenSecretId = (serverId: string): string => `git-server:${serverId}:token`;
const sshKeySecretId = (serverId: string): string => `git-server:${serverId}:ssh-key`;

const MAX_ERROR_LENGTH = 2000;

export class RepositoryStore {
  constructor(private readonly pool: Pool) {}

  /** Repository ids, optionally only those in one sync status. */
  async ids(status?: SyncStatus): Promise<string[]> {
    const result =
      status === undefined
        ? await this.pool.query<{ id: string }>("select id from admin.git_repository order by id")
        : await this.pool.query<{ id: string }>("select id from admin.git_repository where sync_status = $1 order by id", [status]);
    return result.rows.map((row) => row.id);
  }

  /** `<server-id>/<repo-id>` of every registered repository — the mirrors to keep. */
  async mirrorKeys(): Promise<Set<string>> {
    const result = await this.pool.query<{ key: string }>("select server_id || '/' || id as key from admin.git_repository");
    return new Set(result.rows.map((row) => row.key));
  }

  /** The repository and its server's credential; undefined once the repository is removed. */
  async target(id: string): Promise<SyncTarget | undefined> {
    const result = await this.pool.query<TargetRow>(
      `select r.id, r.server_id, r.url, r.default_branch, s.auth_type, s.username, s.known_hosts
         from admin.git_repository r join admin.git_server s on s.id = r.server_id
        where r.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      id: row.id,
      serverId: row.server_id,
      url: row.url,
      ...(row.default_branch === null ? {} : { defaultBranch: row.default_branch }),
      credential: await this.#credential(row),
      ...(row.known_hosts === null ? {} : { knownHosts: row.known_hosts }),
    };
  }

  async markCloning(id: string): Promise<void> {
    await this.pool.query("update admin.git_repository set sync_status = 'cloning', updated_at = now() where id = $1", [id]);
  }

  async markReady(id: string, commit: string): Promise<void> {
    await this.pool.query(
      "update admin.git_repository set sync_status = 'ready', last_commit = $2, last_synced_at = now(), last_error = null, updated_at = now() where id = $1",
      [id, commit],
    );
  }

  /** Records a failed sync; `message` comes from @kintsugi/git and is already redacted. */
  async markError(id: string, message: string): Promise<void> {
    await this.pool.query("update admin.git_repository set sync_status = 'error', last_error = $2, updated_at = now() where id = $1", [
      id,
      message.slice(0, MAX_ERROR_LENGTH),
    ]);
  }

  /** A server stores at most one secret: the token or the SSH key of its auth type. */
  async #credential(row: TargetRow): Promise<GitCredential> {
    if (row.auth_type === "none") return { kind: "none" };
    const secretId = row.auth_type === "token" ? tokenSecretId(row.server_id) : sshKeySecretId(row.server_id);
    const secret = await this.#readSecret(row.server_id, secretId);
    if (secret === undefined) throw new Error(`Git server ${row.server_id} has no stored credential`);
    const plaintext = decryptSecret(secret);
    return row.auth_type === "token"
      ? { kind: "token", token: plaintext, ...(row.username === null ? {} : { username: row.username }) }
      : { kind: "ssh-key", privateKey: plaintext };
  }

  async #readSecret(serverId: string, secretId: string): Promise<{ ciphertext: string; iv: string; authTag: string } | undefined> {
    const result = await this.pool.query<{ ciphertext: string; iv: string; auth_tag: string }>(
      "select ciphertext, iv, auth_tag from admin.git_secret where secret_id = $1 and server_id = $2",
      [secretId, serverId],
    );
    const secret = result.rows[0];
    return secret === undefined ? undefined : { ciphertext: secret.ciphertext, iv: secret.iv, authTag: secret.auth_tag };
  }
}
