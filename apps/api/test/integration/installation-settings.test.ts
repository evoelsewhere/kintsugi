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

interface CodingAgentConnectionLifetimeView {
  maxAgeDays: 15 | 30;
  isDefault: boolean;
  updatedBy?: string;
  updatedAt?: string;
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

    it("defaults the Coding Agent Workflow connection age to 15 days and requires security.manage", async () => {
      const current = await admin.get<CodingAgentConnectionLifetimeView>("/admin/settings/coding-agent-connection-lifetime");
      expect(current.body.data).toEqual({ maxAgeDays: 15, isDefault: true });
      const { client } = await memberClient(app, admin, "connection-lifetime-reader", ["user"]);
      expect((await client.get("/admin/settings/coding-agent-connection-lifetime")).status).toBe(403);
      expect((await client.request("PUT", "/admin/settings/coding-agent-connection-lifetime", { body: { maxAgeDays: 30 } })).status).toBe(403);
    });

    it("stores a 30-day connection age and refuses values outside 15 or 30", async () => {
      const saved = await admin.request<CodingAgentConnectionLifetimeView>("PUT", "/admin/settings/coding-agent-connection-lifetime", { body: { maxAgeDays: 30 } });
      expect(saved.status).toBe(200);
      expect(saved.body.data).toMatchObject({ maxAgeDays: 30, isDefault: false, updatedBy: "admin" });
      expect(saved.body.data).not.toHaveProperty("token");
      expect(saved.body.data).not.toHaveProperty("secret");
      const row = await app.db.query<{ value: { maxAgeDays: number } }>("select value from admin.installation_setting where key = 'coding-agent-connection-lifetime'");
      expect(row.rows[0]?.value).toEqual({ maxAgeDays: 30 });
      for (const body of [{ maxAgeDays: 14 }, { maxAgeDays: 31 }, { maxAgeDays: 15.5 }, { maxAgeDays: "30" }, {}]) {
        const refused = await admin.request("PUT", "/admin/settings/coding-agent-connection-lifetime", { body });
        expect(refused.status).toBe(400);
        expect(refused.body).toMatchObject({ success: false, statusCode: 400 });
      }
      expect((await admin.get<CodingAgentConnectionLifetimeView>("/admin/settings/coding-agent-connection-lifetime")).body.data?.maxAgeDays).toBe(30);
    });

    describe("sandbox environment (ADR-0055)", () => {
      interface SandboxView { checkoutHours: number; retentionDays: number; scriptTimeoutSec: number; agentTimeoutSec: number; agentIdleTimeoutSec: number; maxOutputBytes: number; maxTurns: number; maxCostUsd: number; markReadOnly: boolean; isDefault: boolean; updatedBy?: string; }
      const DEFAULTS = { checkoutHours: 24, retentionDays: 7, scriptTimeoutSec: 600, agentTimeoutSec: 0, agentIdleTimeoutSec: 300, maxOutputBytes: 52428800, maxTurns: 0, maxCostUsd: 0, markReadOnly: true };
      it("starts with the defaults and needs sandbox.manage", async () => {
        expect((await admin.get<SandboxView>("/admin/settings/sandbox")).body.data).toEqual({ ...DEFAULTS, isDefault: true });
        const { client } = await memberClient(app, admin, "sandbox-user", ["user"]);
        expect((await client.get("/admin/settings/sandbox")).status).toBe(403);
        expect((await client.request("PUT", "/admin/settings/sandbox", { body: DEFAULTS })).status).toBe(403);
      });
      it("stores valid settings, audits them, and names every field out of range", async () => {
        const body = { ...DEFAULTS, checkoutHours: 48, retentionDays: 14, agentTimeoutSec: 3600, maxTurns: 80, maxCostUsd: 2.5, markReadOnly: false };
        const saved = await admin.request<SandboxView>("PUT", "/admin/settings/sandbox", { body });
        expect(saved.status, saved.raw).toBe(200);
        expect(saved.body.data).toEqual({ ...body, isDefault: false, updatedBy: "admin", updatedAt: expect.any(String) });
        const row = await app.db.query<{ value: Record<string, unknown> }>("select value from admin.installation_setting where key = 'sandbox'");
        expect(row.rows[0]?.value).toEqual(body);
        const audit = await app.db.query<{ detail: Record<string, unknown> }>("select detail from governance.audit_event where action = 'sandbox.update'");
        expect(audit.rows.map((entry) => entry.detail)).toEqual([expect.objectContaining({ checkoutHours: 48, markReadOnly: false })]);
        const refused = await admin.request<{ message: string[] }>("PUT", "/admin/settings/sandbox", { body: { ...body, checkoutHours: 0, scriptTimeoutSec: 1.5, agentIdleTimeoutSec: 5 } });
        expect(refused.status).toBe(400);
        expect(JSON.stringify(refused.body)).toContain("Checkout hours must be between 1 and 720");
        expect(JSON.stringify(refused.body)).toContain("Script timeout must be a whole number");
        expect(JSON.stringify(refused.body)).toContain("Agent idle timeout must be 0 or between 30 and 3600");
        expect((await admin.request("PUT", "/admin/settings/sandbox", { body: { checkoutHours: 3 } })).status).toBe(400);
        expect((await admin.get<SandboxView>("/admin/settings/sandbox")).body.data?.checkoutHours).toBe(48);
      });
    });
});
