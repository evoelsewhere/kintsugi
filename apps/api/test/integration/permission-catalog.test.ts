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

  it("offers only permissions the code checks", () => {
    expect(catalog.filter((code) => !source.includes(`"${code}"`))).toEqual([]);
    expect(catalog.filter((code) => REMOVED.includes(code))).toEqual([]);
  });

  it("describes the primary roles by what they can do", async () => {
    const roles = (await app.db.query<{ id: string; description: string }>("select id, description from core.role where id in ('user', 'contribute')")).rows;
    expect(roles).toHaveLength(2);
    for (const role of roles) expect(role.description, role.id).not.toMatch(/catalog|publish|secret|usage|monitoring/i);
  });
});
