// The tables an incremental Brain build needs (migration 054): applied twice without error, defaults for the index
// an older build left, and the checks of the new columns.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { startTestApp, type TestApp } from "../support/app.js";

const MIGRATION = resolve(import.meta.dirname, "../../migrations/054_brain_ref.sql");

describe.skipIf(!hasDatabase)("brain schema (integration)", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startTestApp();
    await app.db.query("insert into admin.project (id, name) values ('shop', 'Shop')");
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it("runs again without error and leaves what it made as it was", async () => {
    const script = await readFile(MIGRATION, "utf8");
    await app.db.query(script);
    await app.db.query(script);
    const columns = await app.db.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'knowledge' and table_name in ('brain_ref', 'brain_node', 'brain_source') and column_name in ('project_id', 'path', 'ordinal', 'from_id', 'kind', 'target_path', 'target_anchor', 'target_id', 'home', 'incremental_builds', 'whole_built_at', 'last_build', 'refs_complete') order by 1, 2",
    );
    expect(columns.rows.filter((row) => row.table_name === "brain_ref").map((row) => row.column_name)).toEqual(["from_id", "kind", "ordinal", "path", "project_id", "target_anchor", "target_id", "target_path"]);
    expect(columns.rows.filter((row) => row.table_name === "brain_node").map((row) => row.column_name)).toContain("home");
    expect(columns.rows.filter((row) => row.table_name === "brain_source").map((row) => row.column_name)).toEqual(["incremental_builds", "last_build", "project_id", "refs_complete", "whole_built_at"]);
    const indexes = await app.db.query<{ indexname: string }>("select indexname from pg_indexes where schemaname = 'knowledge' and tablename = 'brain_ref' order by 1");
    expect(indexes.rows.map((row) => row.indexname)).toEqual(["brain_ref_from_idx", "brain_ref_pkey", "brain_ref_target_id_idx", "brain_ref_target_path_idx"]);
  });

  it("gives an index an older build made no references, and a whole build to come", async () => {
    await app.db.query("insert into knowledge.brain_source (project_id, branch) values ('shop', 'main')");
    const row = (await app.db.query<{ refs_complete: boolean; incremental_builds: number; last_build: string | null; whole_built_at: Date | null }>("select refs_complete, incremental_builds, last_build, whole_built_at from knowledge.brain_source where project_id = 'shop'")).rows[0];
    expect(row).toEqual({ refs_complete: false, incremental_builds: 0, last_build: null, whole_built_at: null });
  });

  it("keeps a reference once per place in a document, and drops them with the index", async () => {
    const insert = (ordinal: number, kind: string) =>
      app.db.query("insert into knowledge.brain_ref (project_id, path, ordinal, from_id, kind, target_path) values ('shop', 'a.md', $1, 'a.md', $2, 'b.md')", [ordinal, kind]);
    await insert(0, "link");
    await expect(insert(0, "link")).rejects.toThrow(/duplicate key/);
    await expect(insert(1, "mention")).rejects.toThrow(/check constraint/);
    await expect(app.db.query("update knowledge.brain_source set last_build = 'sometimes' where project_id = 'shop'")).rejects.toThrow(/check constraint/);
    await expect(app.db.query("update knowledge.brain_source set incremental_builds = -1 where project_id = 'shop'")).rejects.toThrow(/check constraint/);
    await app.db.query("delete from knowledge.brain_source where project_id = 'shop'");
    expect((await app.db.query("select 1 from knowledge.brain_ref where project_id = 'shop'")).rowCount).toBe(0);
  });
});
