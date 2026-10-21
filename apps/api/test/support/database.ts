// Throwaway Postgres databases for integration tests. The server comes from
// DATABASE_URL (environment, else the repo-root .env); tests never touch the database
// it names — each test file creates its own `kintsugi_api_test_*` and drops it after.

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { databaseUrlFromEnvironment } from "../../../../scripts/member-db-config.mjs";
import pg from "pg";

function serverUrl(): URL | undefined {
  const raw = databaseUrlFromEnvironment(process.env, resolve(import.meta.dirname, "../../../../.env"));
  return raw === undefined ? undefined : new URL(raw);
}

/** False when no Postgres is configured: integration suites skip themselves. */
export const hasDatabase = serverUrl() !== undefined;

export interface TestDatabase {
  url: string;
  /** Runs SQL against the test database. */
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
  drop(): Promise<void>;
}

async function onMaintenanceDb<T>(server: URL, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const maintenance = new URL(server);
  maintenance.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const server = serverUrl();
  if (server === undefined) throw new Error("DATABASE_URL is not configured");
  const name = `kintsugi_api_test_${randomBytes(4).toString("hex")}`;
  await onMaintenanceDb(server, (client) => client.query(`create database ${name}`));

  const url = new URL(server);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  return {
    url: url.toString(),
    query: (sql, params) => pool.query(sql, params),
    drop: async () => {
      await pool.end();
      await onMaintenanceDb(server, (client) => client.query(`drop database if exists ${name} with (force)`));
    },
  };
}
