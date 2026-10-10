// Throwaway Postgres database for worker tests, with the installation schema applied from
// apps/api/migrations (the API owns it). The server comes from DATABASE_URL (environment,
// else the repo-root .env); the database it names is never touched.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const repoRoot = resolve(import.meta.dirname, "../../../..");

function serverUrl(): URL | undefined {
  let raw = process.env["DATABASE_URL"];
  const envFile = resolve(repoRoot, ".env");
  if ((raw === undefined || raw === "") && existsSync(envFile)) {
    raw = /^DATABASE_URL=(.*)$/m.exec(readFileSync(envFile, "utf8"))?.[1]?.trim();
  }
  return raw === undefined || raw === "" ? undefined : new URL(raw);
}

/** False when no Postgres is configured: integration suites skip themselves. */
export const hasDatabase = serverUrl() !== undefined;

export interface TestDatabase {
  url: string;
  pool: pg.Pool;
  drop(): Promise<void>;
}

async function onMaintenanceDb(server: URL, sql: string): Promise<void> {
  const maintenance = new URL(server);
  maintenance.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const server = serverUrl();
  if (server === undefined) throw new Error("DATABASE_URL is not configured");
  const name = `kintsugi_worker_test_${randomBytes(4).toString("hex")}`;
  await onMaintenanceDb(server, `create database ${name}`);

  const url = new URL(server);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  const migrations = resolve(repoRoot, "apps/api/migrations");
  for (const file of (await readdir(migrations)).filter((entry) => entry.endsWith(".sql")).sort()) {
    await pool.query(await readFile(resolve(migrations, file), "utf8"));
  }
  return {
    url: url.toString(),
    pool,
    drop: async () => {
      await pool.end();
      await onMaintenanceDb(server, `drop database if exists ${name} with (force)`);
    },
  };
}
