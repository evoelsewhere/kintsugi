// Upgrade the currently shipped schema (through upstream 018), preserving installation data.
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasDatabase, type TestDatabase } from "../support/database.js";
import { adminClient, Client, startTestAppWithDatabase, type TestApp } from "../support/app.js";
import { seedLegacyMemberToken } from "../support/legacy-member-token.js";

describe.skipIf(!hasDatabase)("Kintsugi member existing-installation upgrade", () => {
  let database: TestDatabase;
  let app: TestApp;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.query("create schema core");
    await database.query("create table core.schema_migrations (version text primary key, applied_at timestamptz not null default now())");
    const directory = resolve(import.meta.dirname, "../../migrations");
    const baseline = (await readdir(directory)).filter((file) => /^\d{3}_.+\.sql$/.test(file) && Number(file.slice(0, 3)) <= 18).sort();
    expect(baseline.at(-1)).toBe("018_document_write_merge_state.sql");
    for (const file of baseline) {
      await database.query(await readFile(resolve(directory, file), "utf8"));
      await database.query("insert into core.schema_migrations(version) values($1)", [file]);
    }
    await database.query("insert into admin.project(id,name) values('existing-project','Existing Project')");
    app = await startTestAppWithDatabase(database);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  it("adds the read workflow without losing existing projects or reapplying recorded migrations", async () => {
    const admin = await adminClient(app);
    expect((await admin.get("/admin/projects/existing-project")).status).toBe(200);
    const me = await admin.get<{ id: string }>("/auth/me");
    expect((await admin.request("POST", "/auth/member-tokens", {
      body: { name: "upgrade check", projectIds: ["existing-project"], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    })).status).toBe(404);
    expect((await admin.request("PUT", "/admin/project-access/existing-project/" + me.body.data!.id, { body: {} })).status).toBe(204);
    const token = await seedLegacyMemberToken(app, {
      userId: me.body.data!.id,
      name: "upgrade fixture",
      projectIds: ["existing-project"],
    });
    const result = await new Client(app).request<{ items: Array<{ projectId: string }> }>("GET", "/member/v1/projects", {
      headers: { authorization: "Bearer " + token.token },
    });
    expect(result.status).toBe(200);
    expect(result.body.data!.items.map((project) => project.projectId)).toEqual(["existing-project"]);

    const versions = await database.query<{ version: string }>("select version from core.schema_migrations order by version");
    const migrationDirectory = resolve(import.meta.dirname, "../../migrations");
    const migrationFiles = (await readdir(migrationDirectory)).filter((file) => /^\d{3}_.+\.sql$/.test(file)).sort();
    expect(versions.rows.map((row) => row.version)).toEqual(migrationFiles);
    const { ensureSchema } = await import("../../src/common/db/pool.js");
    await ensureSchema();
    expect((await database.query("select version from core.schema_migrations")).rowCount).toBe(versions.rowCount);
  });
});
