// Postgres access (ADR-0010: PostgreSQL is the only datastore). The connection
// string is deployment configuration (DATABASE_URL); provider settings live in the
// database and are managed in the portal — never in environment variables.
//
// Schema convention: one database, one schema per domain —
//   core · admin · delivery · monitoring · governance · knowledge · workflow.
// Migrations create their own schema and qualify table names explicitly.

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url.length === 0) {
    throw new Error("DATABASE_URL is not set; point it at the installation's Postgres (ADR-0010)");
  }
  pool ??= new Pool({ connectionString: url, max: 10 });
  return pool;
}

/** Anything that runs queries: the pool, or a client inside a transaction. */
export type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/**
 * Runs `work` in one transaction on a dedicated client: commit on success,
 * rollback (and rethrow) on failure. Pass the client to every query of the unit.
 */
export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>, client?: PoolClient): Promise<T> {
  const owned = client === undefined;
  const db = client ?? (await getPool().connect());
  try {
    await db.query("begin");
    const result = await work(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    if (owned) db.release();
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Session-level advisory lock key: one migrator at a time across processes. */
const MIGRATION_LOCK = 0x6b696e74; // "kint"

/** Applies every migrations/*.sql not yet recorded in core.schema_migrations. */
export async function ensureSchema(): Promise<void> {
  const migrationsDir = resolve(import.meta.dirname, "../../../migrations");
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  const client = await getPool().connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query("create schema if not exists core");
    await client.query(`create table if not exists core.schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )`);

    for (const file of files) {
      const applied = await client.query("select 1 from core.schema_migrations where version = $1", [file]);
      if ((applied.rowCount ?? 0) > 0) continue;

      const sql = await readFile(resolve(migrationsDir, file), "utf8");
      try {
        await withTransaction(async (tx) => {
          await tx.query(sql);
          await tx.query("insert into core.schema_migrations (version) values ($1)", [file]);
        }, client);
      } catch (error) {
        throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}
