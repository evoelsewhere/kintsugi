// The plugin marketplace (ADR-0035): the built-in plugins, their components and files, readable by any signed-in user.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

interface Summary {
  name: string;
  audience: string;
  source: string;
  counts: Record<string, number>;
}

interface Detail extends Summary {
  components: Array<{ kind: string; name: string; path: string }>;
  files: Array<{ path: string; size: number }>;
}

describe.skipIf(!hasDatabase)("plugins (integration)", () => {
  let app: TestApp;
  let admin: Client;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("lists the built-in plugins with their component counts", async () => {
    const { client } = await memberClient(app, admin, "plugin-reader", ["user"]);
    const list = await client.get<Summary[]>("/admin/plugins");
    expect(list.status).toBe(200);
    expect(list.body.data!.map((plugin) => [plugin.name, plugin.audience, plugin.source])).toEqual([
      ["context", "member", "builtin"],
      ["reverse_engineering", "runtime", "builtin"],
      ["modernize", "runtime", "builtin"],
    ]);
    const pluginsByName = new Map(list.body.data!.map((plugin) => [plugin.name, plugin]));
    expect(pluginsByName.get("reverse_engineering")!.counts).toMatchObject({ agent: 4, command: 3, workflow: 3, skill: 3 });
    expect(pluginsByName.get("modernize")!.counts).toMatchObject({ agent: 3, command: 1, skill: 3 });
    expect(pluginsByName.get("context")!.counts).toMatchObject({ skill: 1 });
  });

  it("opens a plugin and reads one of its files", async () => {
    const detail = await admin.get<Detail>("/admin/plugins/reverse_engineering");
    expect(detail.status).toBe(200);
    expect(detail.body.data!.files.map((file) => file.path)).toEqual(expect.arrayContaining([".claude-plugin/plugin.json", "agents/legacy-analyst.md"]));
    const file = await admin.get<{ path: string; content: string }>("/admin/plugins/reverse_engineering/file?path=agents/legacy-analyst.md");
    expect(file.status).toBe(200);
    expect(file.body.data!.content).toContain("name: legacy-analyst");
    expect((await admin.get("/admin/plugins/reverse_engineering/file?path=commands/modernize-design.md")).status).toBe(404);
    expect((await admin.get("/admin/plugins/missing")).status).toBe(404);
  });
});
