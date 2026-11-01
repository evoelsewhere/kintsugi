// The Compose package's database role (P-030): the app and the worker connect as a role that is not a superuser and owns
// the installation's database. Runs the `db-roles` script of deploy/compose/docker-compose.yml, as its bootstrap
// superuser would, on a fresh database and on one an older installation filled as the superuser, then migrates and
// writes as the application's role. Needs a server account that can create roles (the dev Postgres's superuser).

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PgBoss } from "pg-boss";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase, serverUrl, testDatabaseName } from "../support/database.js";

const COMPOSE = resolve(import.meta.dirname, "../../../../deploy/compose/docker-compose.yml");

/** The psql script of the db-roles service, one statement per line. */
async function rolesScript(): Promise<string[]> {
  const compose = await readFile(COMPOSE, "utf8");
  const body = /<<'SQL'\r?\n([\s\S]*?)\r?\n\s*SQL\r?\n/.exec(compose)?.[1];
  if (body === undefined) throw new Error("db-roles script not found in docker-compose.yml");
  return body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
}

/** Runs the script like `psql -v app_role=… -v app_password=…`: variables substituted, `\gexec` runs each result. */
async function runAsPsql(client: pg.Client, lines: readonly string[], variables: Record<string, string>): Promise<void> {
  for (const line of lines) {
    expect(line.endsWith(";") || line.endsWith("\\gexec"), line).toBe(true);
    const sql = line
      .replace(/:'(\w+)'/g, (_match, name: string) => client.escapeLiteral(variables[name]!))
      .replace(/:"(\w+)"/g, (_match, name: string) => client.escapeIdentifier(variables[name]!));
    if (!sql.endsWith("\\gexec")) {
      await client.query(sql);
      continue;
    }
    const { rows } = await client.query<Record<string, string>>({ text: sql.slice(0, -"\\gexec".length), rowMode: "array" } as never);
    for (const row of rows as unknown as string[][]) for (const statement of row) await client.query(statement);
  }
}

function urlFor(role: string, password: string, database: string): string {
  const url = new URL(serverUrl()!);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Applies the API's migrations as the role in `url`, as the app does at start, and starts the job queue as the worker does. */
async function migrateAs(url: string): Promise<number> {
  const previous = process.env["DATABASE_URL"];
  process.env["DATABASE_URL"] = url;
  const { closePool, ensureSchema, getPool } = await import("#common/db/pool.js");
  try {
    await ensureSchema();
    const boss = new PgBoss({ connectionString: url, schema: "pgboss", supervise: false, schedule: false, max: 2 });
    await boss.start();
    await boss.createQueue("db-role-probe");
    await boss.stop({ graceful: false });
    return (await getPool().query<{ n: number }>("select count(*)::int as n from core.schema_migrations")).rows[0]!.n;
  } finally {
    await closePool();
    if (previous === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = previous;
  }
}

describe.skipIf(!hasDatabase)("Compose database role (integration)", () => {
  const suffix = randomBytes(4).toString("hex");
  const boot = { role: `kt_boot_${suffix}`, password: randomBytes(12).toString("hex") };
  const app = { role: `kt_app_${suffix}`, password: randomBytes(12).toString("hex") };
  const databases: string[] = [];
  let admin: pg.Client;
  let canCreateRoles = false;
  let script: string[];

  beforeAll(async () => {
    const maintenance = new URL(serverUrl()!);
    maintenance.pathname = "/postgres";
    admin = await connect(maintenance.toString());
    canCreateRoles = (await admin.query<{ ok: boolean }>("select rolsuper as ok from pg_roles where rolname = current_user")).rows[0]?.ok === true;
    if (canCreateRoles) await admin.query(`create role ${boot.role} login superuser password ${admin.escapeLiteral(boot.password)}`);
    script = await rolesScript();
  });

  afterAll(async () => {
    if (admin === undefined) return;
    for (const name of databases) await admin.query(`drop database if exists ${admin.escapeIdentifier(name)} with (force)`);
    if (canCreateRoles) await admin.query(`drop role if exists ${app.role}`).then(() => admin.query(`drop role if exists ${boot.role}`));
    await admin.end();
  });

  /** A database owned by the bootstrap superuser, as `POSTGRES_USER` / `POSTGRES_DB` make it. */
  async function bootstrapDatabase(): Promise<string> {
    const name = testDatabaseName(Date.now());
    databases.push(name);
    await admin.query(`create database ${name} owner ${boot.role}`);
    return name;
  }

  async function runScript(database: string): Promise<void> {
    const client = await connect(urlFor(boot.role, boot.password, database));
    try {
      await runAsPsql(client, script, { app_role: app.role, app_password: app.password });
    } finally {
      await client.end();
    }
  }

  async function ownedByBoot(database: string): Promise<string[]> {
    const client = await connect(urlFor(boot.role, boot.password, database));
    try {
      const { rows } = await client.query<{ object: string }>(
        `select 'schema ' || nspname as object from pg_namespace where nspowner = current_user::regrole and nspname !~ '^pg_' and nspname <> 'information_schema'
         union all select 'relation ' || c.oid::regclass from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relowner = current_user::regrole and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
         union all select 'routine ' || p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proowner = current_user::regrole and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
         union all select 'type ' || t.oid::regtype from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.typowner = current_user::regrole and n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and t.typtype in ('e', 'd', 'r')
         union all select 'database ' || datname from pg_database where datname = current_database() and datdba = current_user::regrole`,
      );
      return rows.map((row) => row.object);
    } finally {
      await client.end();
    }
  }

  it("makes the application's role a non-superuser that owns a fresh database, where the migrations run", async (context) => {
    if (!canCreateRoles) context.skip();
    const database = await bootstrapDatabase();
    await runScript(database);
    const role = (await admin.query("select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin from pg_roles where rolname = $1", [app.role])).rows[0];
    expect(role).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true });
    expect((await admin.query("select pg_get_userbyid(datdba) as owner from pg_database where datname = $1", [database])).rows[0]).toEqual({ owner: app.role });

    const migrations = await migrateAs(urlFor(app.role, app.password, database));
    const files = (await import("node:fs/promises")).readdir(resolve(import.meta.dirname, "../../migrations"));
    expect(migrations).toBe((await files).filter((file) => file.endsWith(".sql")).length);
    // Running it again on every start changes nothing and keeps the role as it is.
    await runScript(database);
    expect(await ownedByBoot(database)).toEqual([]);
  });

  it("moves an installation the superuser filled to the application's role, which can then migrate and write", async (context) => {
    if (!canCreateRoles) context.skip();
    const database = await bootstrapDatabase();
    // An installation from before the role existed: the app ran as the bootstrap superuser.
    await migrateAs(urlFor(boot.role, boot.password, database));
    expect((await ownedByBoot(database)).length).toBeGreaterThan(10);

    await runScript(database);
    expect(await ownedByBoot(database)).toEqual([]);

    const appUrl = urlFor(app.role, app.password, database);
    expect(await migrateAs(appUrl)).toBeGreaterThan(40);
    const client = await connect(appUrl);
    try {
      // The role owns what is there: it can change a table a migration made and write to it.
      await client.query("alter table core.schema_migrations add column probe int");
      await client.query("alter table core.schema_migrations drop column probe");
      await client.query("insert into core.schema_migrations (version) values ('zz_probe.sql')");
      await expect(client.query("create role kt_should_fail")).rejects.toThrow(/permission denied/);
      await expect(client.query(`create database ${testDatabaseName(Date.now())}`)).rejects.toThrow(/permission denied/);
    } finally {
      await client.end();
    }
  });
});
