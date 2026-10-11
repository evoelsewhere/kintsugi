// Postgres adapter of installation settings (migration 011: admin.installation_setting).

import { Injectable } from "@nestjs/common";
import { getPool } from "#common/db/pool.js";
import { InstallationSettings, type StoredSetting } from "../domain/installation-settings.js";

interface Row {
  value: unknown;
  updated_by: string | null;
  updated_at: Date;
}

const toSetting = <T>(row: Row): StoredSetting<T> => ({
  value: row.value as T,
  ...(row.updated_by === null ? {} : { updatedBy: row.updated_by }),
  updatedAt: row.updated_at.toISOString(),
});

@Injectable()
export class PgInstallationSettings extends InstallationSettings {
  async get<T>(key: string): Promise<StoredSetting<T> | undefined> {
    const result = await getPool().query<Row>("select value, updated_by, updated_at from admin.installation_setting where key = $1", [key]);
    const row = result.rows[0];
    return row === undefined ? undefined : toSetting<T>(row);
  }

  async put<T>(key: string, value: T, updatedBy: string): Promise<StoredSetting<T>> {
    const result = await getPool().query<Row>(
      `insert into admin.installation_setting (key, value, updated_by, updated_at) values ($1, $2, $3, now())
       on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
       returning value, updated_by, updated_at`,
      [key, JSON.stringify(value), updatedBy],
    );
    return toSetting<T>(result.rows[0]!);
  }
}
