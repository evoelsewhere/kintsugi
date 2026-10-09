// Postgres access (ADR-0010: PostgreSQL is the only datastore). The connection
// string is deployment configuration (DATABASE_URL); provider settings live in the
// database and are managed in the portal — never in environment variables.
//
// Schema convention: one database, one schema per domain —
//   core · admin · delivery · monitoring · governance · knowledge · workflow.
// Migrations create their own schema and qualify table names explicitly.

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url.length === 0) {
    throw new Error("DATABASE_URL is not set; point it at the installation's Postgres (ADR-0010)");
  }
  pool ??= new Pool({ connectionString: url, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Applies every migrations/*.sql not yet recorded in core.schema_migrations. */
export async function ensureSchema(): Promise<void> {
  const db = getPool();
  await db.query("create schema if not exists core");
  await db.query(`create table if not exists core.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )`);

  const migrationsDir = resolve(import.meta.dirname, "../../../migrations");
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const applied = await db.query("select 1 from core.schema_migrations where version = $1", [file]);
    if ((applied.rowCount ?? 0) > 0) continue;

    const sql = await readFile(resolve(migrationsDir, file), "utf8");
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into core.schema_migrations (version) values ($1)", [file]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }
}
