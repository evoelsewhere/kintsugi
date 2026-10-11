// Installation settings (migration 011): the commit identity of kintsugi-bot is managed in the
// portal by holders of git.manage; the worker reads the same row per write.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { type Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

interface IdentityView {
  name: string;
  email: string;
  isDefault: boolean;
  updatedBy?: string;
}

describe.skipIf(!hasDatabase)("installation settings: commit identity (integration)", () => {
  let app: TestApp;
  let admin: Client;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("starts with the defaults and needs git.manage", async () => {
    const current = await admin.get<IdentityView>("/admin/settings/commit-identity");
    expect(current.body.data).toEqual({ name: "kintsugi-bot", email: "kintsugi-bot@kintsugi.invalid", isDefault: true });
    const { client } = await memberClient(app, admin, "plain-user", ["user"]);
    expect((await client.get("/admin/settings/commit-identity")).status).toBe(403);
    expect((await client.request("PUT", "/admin/settings/commit-identity", { body: { name: "x", email: "x@example.com" } })).status).toBe(403);
  });

  it("stores a valid identity in admin.installation_setting and refuses unusable ones", async () => {
    const saved = await admin.request<IdentityView>("PUT", "/admin/settings/commit-identity", { body: { name: " Modernization Bot ", email: "bot@example.com" } });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ name: "Modernization Bot", email: "bot@example.com", isDefault: false, updatedBy: "admin" });
    const row = await app.db.query<{ value: { name: string; email: string } }>("select value from admin.installation_setting where key = 'commit-identity'");
    expect(row.rows[0]?.value).toEqual({ name: "Modernization Bot", email: "bot@example.com" });

    for (const body of [
      { name: "Bot <x>", email: "bot@example.com" },
      { name: "Bot", email: "Bot <bot@example.com>" },
      { name: "", email: "bot@example.com" },
    ]) {
      const refused = await admin.request("PUT", "/admin/settings/commit-identity", { body });
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ success: false, statusCode: 400 });
    }
    expect((await admin.get<IdentityView>("/admin/settings/commit-identity")).body.data?.name).toBe("Modernization Bot");
  });
});
