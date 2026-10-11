// Postgres adapter for installation access roles & permissions (schema: core).

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool, withTransaction } from "#common/db/pool.js";
import type { CreateSubRole, PermissionRecord, RoleRecord } from "../domain/role.js";
import { RoleRepository } from "../domain/role.repository.js";

interface RoleRow {
  id: string;
  kind: "primary" | "sub";
  name: string;
  description: string;
}

@Injectable()
export class PgRoleRepository extends RoleRepository {
  get #pool(): Pool {
    return getPool();
  }

  async list(): Promise<RoleRecord[]> {
    const result = await this.#pool.query<RoleRow>("select id, kind, name, description from core.role order by kind, id");
    return Promise.all(result.rows.map((row) => this.#toRecord(row)));
  }

  async get(id: string): Promise<RoleRecord | undefined> {
    const result = await this.#pool.query<RoleRow>("select id, kind, name, description from core.role where id = $1", [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : this.#toRecord(row);
  }

  async createSubRole(input: CreateSubRole): Promise<RoleRecord> {
    await this.#pool.query("insert into core.role (id, kind, name, description) values ($1, 'sub', $2, $3)", [
      input.id,
      input.name,
      input.description ?? "",
    ]);
    return (await this.get(input.id))!;
  }

  async removeSubRole(id: string): Promise<boolean> {
    const result = await this.#pool.query("delete from core.role where id = $1 and kind = 'sub'", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async setPermissions(roleId: string, codes: string[]): Promise<RoleRecord | undefined> {
    await withTransaction(async (client) => {
      await client.query("delete from core.role_permission where role_id = $1", [roleId]);
      for (const code of codes) {
        await client.query("insert into core.role_permission (role_id, permission_code) values ($1, $2) on conflict do nothing", [roleId, code]);
      }
    });
    return this.get(roleId);
  }

  async listPermissions(): Promise<PermissionRecord[]> {
    const result = await this.#pool.query<{ code: string; group_name: string; description: string }>(
      "select code, group_name, description from core.permission order by group_name, code",
    );
    return result.rows.map((row) => ({ code: row.code, group: row.group_name, description: row.description }));
  }

  async permissionsOfUser(userId: string): Promise<string[]> {
    const result = await this.#pool.query<{ permission_code: string }>(
      `select distinct rp.permission_code
       from core.user_role ur
       join core.role_permission rp on rp.role_id = ur.role_id
       where ur.user_id = $1
       order by rp.permission_code`,
      [userId],
    );
    return result.rows.map((row) => row.permission_code);
  }

  async #toRecord(row: RoleRow): Promise<RoleRecord> {
    const grants = await this.#pool.query<{ permission_code: string }>(
      "select permission_code from core.role_permission where role_id = $1 order by permission_code",
      [row.id],
    );
    return { ...row, permissions: grants.rows.map((entry) => entry.permission_code) };
  }
}
