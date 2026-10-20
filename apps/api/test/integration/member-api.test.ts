import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror } from "@kintsugi/git";
import type { GitHttpServer } from "@kintsugi/git/testing";
import { startGitHttpServer } from "@kintsugi/git/testing";
import {
  documentPageSchema,
  documentSearchResultSchema,
  projectListResultSchema,
  taskBriefSchema,
  taskListResultSchema,
  taskStatusSchema,
} from "@kintsugi/harness-sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasDatabase, createTestDatabase, type TestDatabase } from "../support/database.js";
import { adminClient, Client, startTestAppWithDatabase, type TestApp } from "../support/app.js";

const unit = [
  "---",
  "id: web/core/invoice",
  "application: web",
  "module: core",
  "kind: module",
  "title: Invoice",
  "phase: migrate",
  "status: pending",
  "---",
  "Task unit.",
  "",
].join("\n");

const taskPack = [
  "# Invoice task",
  "",
  "## Objective",
  "Calculate invoice tax using the approved rounding rule.",
  "",
  "## Acceptance criteria",
  "- Round consistently per invoice.",
  "",
].join("\n");

const withQuery = (path: string, params: Record<string, string>): string => `${path}?${new URLSearchParams(params)}`;

describe.skipIf(!hasDatabase)("Coding Agent Workflow versioned read API (integration)", () => {
  let app: TestApp;
  let database: TestDatabase;
  let remote: GitHttpServer;
  let worker: { stop(): Promise<void> } | undefined;
  let dataDir: string;
  let token: string;
  let memberId: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  beforeAll(async () => {
    database = await createTestDatabase();
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-member-api-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    await remote.commit("docs", "applications/web/units/core/invoice/unit.md", unit);
    await remote.commit("docs", "applications/web/units/core/invoice/task.md", taskPack);
    await remote.commit("docs", "applications/web/units/core/invoice/as-is.md", "# Current behavior\nInvoices round per line.\n");
    await remote.commit("docs", "applications/web/design.md", "# Web basic design\nInvoice rounding is defined here.\n");
    await remote.commit("docs", "applications/web/units/core/invoice/design.md", "# Detailed design\nUse decimal arithmetic and round once.\n");
    await cloneMirror(remote.baseUrl + "/docs.git", new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    app = await startTestAppWithDatabase(database);
    const admin = await adminClient(app);
    await app.db.query("insert into core.role_permission (role_id, permission_code) values ('admin', 'member.read') on conflict do nothing");
    await app.db.query(
      "insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', $1, 'none')",
      [remote.baseUrl],
    );
    await app.db.query(
      "insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', $1, 'main')",
      [remote.baseUrl + "/docs.git"],
    );
    expect((await admin.request("POST", "/admin/projects", {
      body: { id: "shop", name: "Shop", documentRepositoryId: "docs" },
    })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications", {
      body: { id: "web", name: "Web", disposition: "refactor" },
    })).status).toBe(201);
    const identity = await admin.get<{ id: string }>("/auth/me");
    memberId = identity.body.data!.id;
    expect((await admin.request("PUT", `/admin/project-access/shop/${memberId}`, { body: {} })).status).toBe(204);
    await app.db.query("insert into admin.project (id, name) values ('hidden', 'Hidden')");
    expect((await admin.request("PUT", `/admin/project-access/hidden/${memberId}`, { body: {} })).status).toBe(204);
    const issued = await admin.request<{ token: string }>("POST", "/auth/member-tokens", {
      body: { name: "api test", projectIds: ["shop"], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(issued.status).toBe(201);
    token = issued.body.data!.token;

    const { getPool } = await import("../../src/common/db/pool.js");
    const { startWorker } = await import("@kintsugi/orchestrator");
    worker = await startWorker({
      databaseUrl: database.url,
      pool: getPool(),
      storage: new CheckoutStorage(dataDir),
      pollIntervalSeconds: 3600,
      cleanupIntervalSeconds: 3600,
      log: () => undefined,
    });
  }, 180_000);

  afterAll(async () => {
    await worker?.stop();
    await app?.close();
    if (database !== undefined) await database.drop();
    await remote?.close();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  const member = (): Client => new Client(app);
  const bearer = (): Record<string, string> => ({ authorization: `Bearer ${token}` });

  it("returns SDK-shaped project, task, brief, document, search and status payloads", async () => {
    const client = member();
    const projects = await client.request("GET", "/member/v1/projects", { csrf: false, headers: bearer() });
    expect(projects.status).toBe(200);
    expect(projectListResultSchema.parse(projects.body.data)).toMatchObject({ items: [{ projectId: "shop", name: "Shop" }] });
    expect((projects.body.data as { items: unknown[] }).items).toHaveLength(1);

    const tasks = await client.request("GET", withQuery("/member/v1/tasks", { projectId: "shop", limit: "25" }), { csrf: false, headers: bearer() });
    expect(tasks.status).toBe(200);
    expect(taskListResultSchema.parse(tasks.body.data).items.map((task) => task.unitId)).toEqual(["web/core/invoice"]);

    const briefPath = withQuery("/member/v1/task-brief", { projectId: "shop", unitId: "web/core/invoice", activity: "implementation" });
    const briefResponse = await client.request("GET", briefPath, { csrf: false, headers: bearer() });
    expect(briefResponse.status).toBe(200);
    const brief = taskBriefSchema.parse(briefResponse.body.data);
    expect(brief.unitId).toBe("web/core/invoice");
    expect(brief.blockers.some((blocker) => blocker.code === "SOURCE_APPROVAL_UNKNOWN")).toBe(true);

    const taskSource = brief.sources.find((source) => source.role === "task-pack");
    expect(taskSource).toBeDefined();
    const documentPath = withQuery("/member/v1/documents", {
      projectId: "shop", unitId: brief.unitId, snapshotId: brief.snapshotId, sourceId: taskSource!.sourceId,
    });
    const document = await client.request("GET", documentPath, { csrf: false, headers: bearer() });
    expect(document.status).toBe(200);
    expect(documentPageSchema.parse(document.body.data).text).toContain("Calculate invoice tax");

    const searchPath = withQuery("/member/v1/search", {
      projectId: "shop", unitId: brief.unitId, snapshotId: brief.snapshotId, query: "rounding rule",
    });
    const search = await client.request("GET", searchPath, { csrf: false, headers: bearer() });
    expect(search.status).toBe(200);
    expect(documentSearchResultSchema.parse(search.body.data).items.length).toBeGreaterThan(0);

    const statusPath = withQuery("/member/v1/task-status", { projectId: "shop", unitId: "web/core/invoice" });
    const status = await client.request("GET", statusPath, { csrf: false, headers: bearer() });
    expect(status.status).toBe(200);
    expect(taskStatusSchema.parse(status.body.data)).toMatchObject({
      evidenceAvailability: { pullRequests: "unavailable", reviews: "unavailable" },
      pullRequests: [],
      currentReviewIds: [],
    });
  }, 60_000);

  it("validates encoded unit slashes and rejects malformed query values and source URLs", async () => {
    const client = member();
    const encodedSlash = withQuery("/member/v1/task-brief", { projectId: "shop", unitId: "web/core/invoice", activity: "implementation" });
    const accepted = await client.request("GET", encodedSlash, { csrf: false, headers: bearer() });
    expect(accepted.status).toBe(200);

    const invalidLimit = await client.request("GET", withQuery("/member/v1/tasks", { projectId: "shop", limit: "0" }), { csrf: false, headers: bearer() });
    expect(invalidLimit.status).toBe(400);
    const badUnit = await client.request("GET", withQuery("/member/v1/task-brief", { projectId: "shop", unitId: "web/core", activity: "implementation" }), { csrf: false, headers: bearer() });
    expect(badUnit.status).toBe(400);

    const briefResponse = await client.request("GET", withQuery("/member/v1/task-brief", {
      projectId: "shop", unitId: "web/core/invoice", activity: "implementation",
    }), { csrf: false, headers: bearer() });
    const brief = taskBriefSchema.parse(briefResponse.body.data);
    const originalFetch = globalThis.fetch;
    const externalFetch = vi.fn();
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://example.invalid/")) externalFetch();
      return originalFetch(input, init);
    }) as typeof fetch;
    try {
      const sourceUrl = await client.request("GET", withQuery("/member/v1/documents", {
        projectId: "shop", unitId: brief.unitId, snapshotId: brief.snapshotId, sourceId: "https://example.invalid/private",
      }), { csrf: false, headers: bearer() });
      expect(sourceUrl.status).toBe(400);
      expect(externalFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);

  it("requires a member token, current permission, token scope and current Project Access", async () => {
    const unauthenticated = await member().get("/member/v1/projects");
    expect(unauthenticated.status).toBe(401);

    const scoped = await member().request("GET", withQuery("/member/v1/tasks", { projectId: "hidden" }), { csrf: false, headers: bearer() });
    expect(scoped.status).toBe(403);
    expect(scoped.raw).not.toContain("Hidden");

    const admin = await adminClient(app);
    await app.db.query("delete from core.role_permission where role_id = 'admin' and permission_code = 'member.read'");
    const permissionDenied = await member().request("GET", "/member/v1/projects", { csrf: false, headers: bearer() });
    expect(permissionDenied.status).toBe(403);
    await app.db.query("insert into core.role_permission (role_id, permission_code) values ('admin', 'member.read') on conflict do nothing");

    expect((await admin.request("DELETE", `/admin/project-access/shop/${memberId}`)).status).toBe(204);
    const projects = await member().request("GET", "/member/v1/projects", { csrf: false, headers: bearer() });
    expect(projectListResultSchema.parse(projects.body.data).items).toEqual([]);
    const revoked = await member().request("GET", withQuery("/member/v1/tasks", { projectId: "shop" }), { csrf: false, headers: bearer() });
    expect(revoked.status).toBe(403);
    expect((await admin.request("PUT", `/admin/project-access/shop/${memberId}`, { body: {} })).status).toBe(204);
  });

  it("returns an explicit unavailable review capability without a passing stub", async () => {
    const response = await member().request("GET", withQuery("/member/v1/reviews/review-1", { projectId: "shop" }), { csrf: false, headers: bearer() });
    expect(response.status).toBe(501);
    expect(response.body).toMatchObject({ success: false, details: { code: "UNSUPPORTED_CAPABILITY", capability: "reviews" } });
    expect(response.raw).not.toContain("verdict");
  });
});
