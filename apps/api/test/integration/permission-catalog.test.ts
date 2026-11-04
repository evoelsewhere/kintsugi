// The permission catalog (core.permission, ADR-0008) and the code agree: every route permission is in the catalog,
// and every permission in the catalog is checked somewhere, so Roles & Permissions offers no toggle that does nothing.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { startTestApp, type TestApp } from "../support/app.js";

const SOURCE = resolve(import.meta.dirname, "../../src");
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });

// Codes added by migration ahead of the module that checks them: the wiki codes of ADR-0099 decision 5 (migration 050)
// are checked from Phase 2 of the wiki roadmap on: `wiki.manage` by the wiki switch (Phase 1), `wiki.write` and `wiki.publish` by the write rules.
// Remove a code from this list when its module lands.
const PLANNED: string[] = [];
const WIKI_CODES = [...PLANNED, "wiki.comment", "wiki.write", "wiki.publish", "wiki.manage"];

const REMOVED = ["subroles.manage", "resource-policy.manage", "agents.publish", "skills.publish", "mcp.publish", "monitoring.team.view", "catalog.consume", "secrets.create", "usage.report"];

describe.skipIf(!hasDatabase)("permission catalog (integration)", () => {
  let app: TestApp;
  let catalog: string[];
  const source = sourceFiles(SOURCE).map((path) => readFileSync(path, "utf8")).join("\n");

  beforeAll(async () => {
    app = await startTestApp();
    catalog = (await app.db.query<{ code: string }>("select code from core.permission order by code")).rows.map((row) => row.code);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("holds every permission a route requires", () => {
    // Permission codes only: `@RequirePermission("<code>")` in a comment is not one.
    const required = new Set([...source.matchAll(/RequirePermission\(\s*"([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)"/g)].map((match) => match[1]!));
    expect(required.size).toBeGreaterThan(10);
    expect([...required].filter((code) => !catalog.includes(code))).toEqual([]);
  });

  it("offers only permissions the code checks, or plans to", () => {
    expect(catalog.filter((code) => !PLANNED.includes(code) && !source.includes(`"${code}"`))).toEqual([]);
    expect(catalog.filter((code) => REMOVED.includes(code))).toEqual([]);
  });

  it("lists a planned permission only until the code checks it", () => {
    expect(PLANNED.filter((code) => !catalog.includes(code))).toEqual([]);
    expect(PLANNED.filter((code) => source.includes(`"${code}"`))).toEqual([]);
  });

  it("offers the wiki permissions under Wiki, held by the admin role", async () => {
    const wiki = (await app.db.query<{ code: string; group_name: string; description: string }>("select code, group_name, description from core.permission where code like 'wiki.%' order by code")).rows;
    expect(wiki.map((row) => row.code)).toEqual([...WIKI_CODES].sort());
    for (const row of wiki) {
      expect(row.group_name, row.code).toBe("Wiki");
      expect(row.description.length, row.code).toBeGreaterThan(10);
    }
    const granted = (await app.db.query<{ permission_code: string }>("select permission_code from core.role_permission where role_id = 'admin' and permission_code like 'wiki.%' order by permission_code")).rows;
    expect(granted.map((row) => row.permission_code)).toEqual([...WIKI_CODES].sort());
  });

  it("adds the wiki permissions again without duplicating them", async () => {
    await app.db.query(readFileSync(resolve(import.meta.dirname, "../../migrations/050_wiki_permissions.sql"), "utf8"));
    expect((await app.db.query("select 1 from core.permission where code like 'wiki.%'")).rowCount).toBe(WIKI_CODES.length);
    expect((await app.db.query("select 1 from core.role_permission where permission_code like 'wiki.%'")).rowCount).toBe(WIKI_CODES.length);
  });

  it("describes the primary roles by what they can do", async () => {
    const roles = (await app.db.query<{ id: string; description: string }>("select id, description from core.role where id in ('user', 'contribute')")).rows;
    expect(roles).toHaveLength(2);
    for (const role of roles) expect(role.description, role.id).not.toMatch(/catalog|publish|secret|usage|monitoring/i);
  });
});
