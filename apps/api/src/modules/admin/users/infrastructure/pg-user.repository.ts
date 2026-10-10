// Postgres adapter for members (ADR-0008; schema: core). Passwords are stored as
// scrypt hashes; roles live in core.user_role.

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { PasswordHash } from "../../../../common/security/password.js";
import { getPool, type Queryable, withTransaction } from "../../../../common/db/pool.js";
import type { CreateUser, UpdateUser, UserRecord } from "../domain/user.js";
import { UserRepository } from "../domain/user.repository.js";

interface UserRow {
  id: string;
  username: string;
  email: string;
  display_name: string;
  enabled: boolean;
  created_at: Date;
}

@Injectable()
export class PgUserRepository extends UserRepository {
  get #pool(): Pool {
    return getPool();
  }

  async list(): Promise<UserRecord[]> {
    const result = await this.#pool.query<UserRow>(
      "select id, username, email, display_name, enabled, created_at from core.app_user order by username",
    );
    return Promise.all(result.rows.map((row) => this.#toRecord(row)));
  }

  async get(id: string): Promise<UserRecord | undefined> {
    const result = await this.#pool.query<UserRow>(
      "select id, username, email, display_name, enabled, created_at from core.app_user where id = $1",
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : this.#toRecord(row);
  }

  async findByUsername(username: string): Promise<UserRecord | undefined> {
    const result = await this.#pool.query<UserRow>(
      "select id, username, email, display_name, enabled, created_at from core.app_user where username = $1",
      [username],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : this.#toRecord(row);
  }

  async count(): Promise<number> {
    const result = await this.#pool.query<{ count: number }>("select count(*)::int as count from core.app_user");
    return result.rows[0]?.count ?? 0;
  }

  async create(id: string, user: CreateUser, password: PasswordHash): Promise<UserRecord> {
    await withTransaction(async (client) => {
      await client.query(
        `insert into core.app_user (id, username, email, display_name, password_hash, password_salt)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, user.username, user.email ?? "", user.displayName ?? user.username, password.hash, password.salt],
      );
      await this.#replaceRoles(client, id, user.roleIds ?? []);
    });
    return (await this.get(id))!;
  }

  async update(id: string, input: UpdateUser): Promise<UserRecord | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };
    if (input.email !== undefined) push("email", input.email);
    if (input.displayName !== undefined) push("display_name", input.displayName);
    if (input.enabled !== undefined) push("enabled", input.enabled);
    await withTransaction(async (client) => {
      if (fields.length > 0) {
        values.push(id);
        await client.query(`update core.app_user set ${fields.join(", ")}, updated_at = now() where id = $${values.length}`, values);
      }
      if (input.roleIds !== undefined) await this.#replaceRoles(client, id, input.roleIds);
    });
    return this.get(id);
  }

  async setPassword(id: string, password: PasswordHash): Promise<void> {
    await this.#pool.query("update core.app_user set password_hash = $2, password_salt = $3, updated_at = now() where id = $1", [
      id,
      password.hash,
      password.salt,
    ]);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.#pool.query("delete from core.app_user where id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async passwordOf(id: string): Promise<PasswordHash | undefined> {
    const result = await this.#pool.query<{ password_hash: string; password_salt: string }>(
      "select password_hash, password_salt from core.app_user where id = $1",
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { hash: row.password_hash, salt: row.password_salt };
  }

  async countEnabledWithRole(roleId: string): Promise<number> {
    const result = await this.#pool.query<{ count: number }>(
      `select count(*)::int as count
       from core.app_user u join core.user_role ur on ur.user_id = u.id
       where u.enabled and ur.role_id = $1`,
      [roleId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async revokeSessions(id: string): Promise<void> {
    await this.#pool.query("delete from core.session where user_id = $1", [id]);
  }

  async #replaceRoles(db: Queryable, userId: string, roleIds: string[]): Promise<void> {
    await db.query("delete from core.user_role where user_id = $1", [userId]);
    for (const roleId of roleIds) {
      await db.query("insert into core.user_role (user_id, role_id) values ($1, $2) on conflict do nothing", [userId, roleId]);
    }
  }

  async #toRecord(row: UserRow): Promise<UserRecord> {
    const roles = await this.#pool.query<{ role_id: string }>("select role_id from core.user_role where user_id = $1 order by role_id", [row.id]);
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      displayName: row.display_name,
      enabled: row.enabled,
      roleIds: roles.rows.map((entry) => entry.role_id),
      createdAt: row.created_at.toISOString(),
    };
  }
}
