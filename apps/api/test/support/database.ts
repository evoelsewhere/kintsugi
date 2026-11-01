// Throwaway Postgres databases for integration tests. The server comes from
// DATABASE_URL (environment, else the repo-root .env); tests never touch the database
// it names — each test file creates its own `kintsugi_api_test_<created>_<random>` and drops
// it after, even when closing the app hangs. A database a killed run left behind is dropped by
// the next run's global setup once it is old enough (`staleTestDatabases`).

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { databaseUrlFromEnvironment } from "../../../../scripts/test-db-config.mjs";
import pg from "pg";

export function serverUrl(): URL | undefined {
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
  const name = testDatabaseName(Date.now());
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

/** A test database's name: the prefix, when it was created (base 36 milliseconds) and a random part. */
export function testDatabaseName(createdAt: number): string {
  return `${TEST_DATABASE_PREFIX}${createdAt.toString(36)}_${randomBytes(4).toString("hex")}`;
}

const TEST_DATABASE_PREFIX = "kintsugi_api_test_";
const TEST_DATABASE_NAME = /^kintsugi_api_test_([0-9a-z]{6,10})_[0-9a-f]{8}$/;
/** A test database is left alone for this long: a run that is still going holds it. */
export const STALE_TEST_DATABASE_MS = 6 * 60 * 60 * 1000;

/**
 * The databases a sweep may drop: only names this harness makes (prefix, creation time, random part) that were created
 * more than STALE_TEST_DATABASE_MS ago, and never the database DATABASE_URL names. Names without a creation time
 * (from before it was recorded) are never swept: their owner removes them.
 */
export function staleTestDatabases(names: readonly string[], now: number, configured: string | undefined): string[] {
  return names.filter((name) => {
    const match = TEST_DATABASE_NAME.exec(name);
    if (match?.[1] === undefined || name === configured) return false;
    const createdAt = Number.parseInt(match[1], 36);
    return Number.isFinite(createdAt) && now - createdAt > STALE_TEST_DATABASE_MS;
  });
}

/** Drops the stale test databases of earlier runs (see `staleTestDatabases`); says how many. */
export async function sweepStaleTestDatabases(now = Date.now()): Promise<string[]> {
  const server = serverUrl();
  if (server === undefined) return [];
  const configured = decodeURIComponent(server.pathname.replace(/^\//, ""));
  return onMaintenanceDb(server, async (client) => {
    const { rows } = await client.query<{ datname: string }>("select datname from pg_database where datname like 'kintsugi\\_api\\_test\\_%'");
    const stale = staleTestDatabases(rows.map((row) => row.datname), now, configured);
    for (const name of stale) await client.query(`drop database if exists ${pg.escapeIdentifier(name)} with (force)`);
    return stale;
  });
}

/**
 * Closes what a test app holds, then drops its database whatever happened: each step gets `timeoutMs` and a step that
 * fails or hangs does not keep the database. The first error is thrown after the drop.
 */
export async function closeThenDrop(steps: ReadonlyArray<() => Promise<void>>, drop: (() => Promise<void>) | undefined, timeoutMs = 20_000): Promise<void> {
  let failure: unknown;
  for (const step of steps) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([step(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`closing the test app took more than ${timeoutMs} ms`)), timeoutMs); })]);
    } catch (error) {
      failure ??= error;
    } finally {
      clearTimeout(timer);
    }
  }
  if (drop !== undefined) await drop();
  if (failure !== undefined) throw failure;
}

