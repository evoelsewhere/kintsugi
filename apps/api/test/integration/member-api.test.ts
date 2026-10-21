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
  reviewReportSchema,
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
  const currentReviewId = "rev_018f0000-0000-4000-8000-000000000001";
  const hiddenReviewId = "rev_018f0000-0000-4000-8000-000000000002";
  const supersededReviewId = "rev_018f0000-0000-4000-8000-000000000003";
  const queuedReviewId = "rev_018f0000-0000-4000-8000-000000000004";
  const failedReviewId = "rev_018f0000-0000-4000-8000-000000000005";
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

    for (const [reviewId, projectId, key, currentness] of [
      [currentReviewId, "shop", "a", "current"],
      [hiddenReviewId, "hidden", "b", "current"],
      [supersededReviewId, "shop", "c", "superseded"],
    ] as const) {
      const report = {
        schemaVersion: "1" as const,
        projectId,
        unitId: "web/core/invoice",
        reviewId,
        generation: 1,
        currentness,
        verdict: "fail" as const,
        reviewedHead: "a".repeat(40),
        reviewedBase: "b".repeat(40),
        mergeBase: "c".repeat(40),
        contextRevision: `sha256:${"d".repeat(64)}`,
        policyRevision: "policy-v1",
        agentVersion: "review-agent-v1",
        coverage: "complete" as const,
        findings: [{
          findingId: "finding-001",
          severity: "high" as const,
          title: "Invoice calculation can overflow",
          rationale: "The amount is multiplied before applying the checked bound.",
          repairGuidance: "Use checked decimal arithmetic and add a boundary test.",
          citation: { sourceId: "pull-request", path: "src/invoice.ts", startLine: 4, endLine: 5 },
          currentness: "current" as const,
        }],
      };
      reviewReportSchema.parse(report);
      await app.db.query(
        `insert into workflow.member_review
           (review_id, review_key, generation, project_id, unit_id, implementation_repository_id, server_id,
            provider, provider_repository_id, provider_pull_request_id, pull_request_number, head_sha, base_sha,
            merge_base_sha, context_revision, policy_revision, agent_version, status, currentness, coverage,
            verdict, input_manifest, report, finished_at)
           values ($1, $2, 1, $3, 'web/core/invoice', 'docs', 'local', 'github', 'repo-1', $4, 1,
                 $5, $6, $7, $8, 'policy-v1', 'review-agent-v1', 'succeeded', $9, 'complete', 'fail',
                 '{}'::jsonb, $10::jsonb, clock_timestamp())`,
        [reviewId, key.repeat(64), projectId, `pull-${key}`, "a".repeat(40), "b".repeat(40), "c".repeat(40),
          `sha256:${"d".repeat(64)}`, currentness, JSON.stringify(report)],
      );
    }
    await app.db.query(
      `insert into workflow.member_review
         (review_id, review_key, generation, project_id, unit_id, implementation_repository_id, server_id,
          provider, provider_repository_id, provider_pull_request_id, pull_request_number, head_sha, base_sha,
          merge_base_sha, context_revision, policy_revision, agent_version, status, currentness, input_manifest)
       values ($1, $2, 1, 'shop', 'web/core/invoice', 'docs', 'local', 'github', 'repo-1', 'pull-d', 1,
               $3, $4, $5, $6, 'policy-v1', 'review-agent-v1', 'queued', 'current', '{}'::jsonb)`,
      [queuedReviewId, "e".repeat(64), "a".repeat(40), "b".repeat(40), "c".repeat(40), `sha256:${"d".repeat(64)}`],
    );
    await app.db.query(
      `insert into workflow.member_review
         (review_id, review_key, generation, project_id, unit_id, implementation_repository_id, server_id,
          provider, provider_repository_id, provider_pull_request_id, pull_request_number, head_sha, base_sha,
          merge_base_sha, context_revision, policy_revision, agent_version, status, currentness, input_manifest,
          failure_code, finished_at)
       values ($1, $2, 1, 'shop', 'web/core/invoice', 'docs', 'local', 'github', 'repo-1', 'pull-e', 1,
               $3, $4, $5, $6, 'policy-v1', 'review-agent-v1', 'failed', 'current', '{}'::jsonb,
               'REVIEW_JOB_FAILED', clock_timestamp())`,
      [failedReviewId, "f".repeat(64), "a".repeat(40), "b".repeat(40), "c".repeat(40), `sha256:${"d".repeat(64)}`],
    );

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

    const confirmedPrUpdatedAt = "2026-10-20T12:00:00.000Z";
    const confirmedPrHead = "1".repeat(40);
    await app.db.query(
      `insert into workflow.member_provider_observation
         (server_id, repository_id, provider_repository_id, provider_pull_request_id, pull_request_number,
          state, head_sha, head_ref, base_sha, base_ref, merge_commit_sha, merged_at, provider_updated_at)
       values ('local', 'docs', 'repo-1', 'pr-confirmed', 42, 'merged', $1, 'feature/invoice', $2, 'main',
               $3, $4, $5),
              ('local', 'docs', 'repo-1', 'pr-unconfirmed', 43, 'open', $1, 'feature/other', $2, 'main',
               null, null, $6)`,
      [confirmedPrHead, "2".repeat(40), "3".repeat(40), confirmedPrUpdatedAt, confirmedPrUpdatedAt, "2026-10-20T11:00:00.000Z"],
    );
    await app.db.query(
      `insert into workflow.member_task_pull_request
         (server_id, repository_id, provider_repository_id, provider_pull_request_id, pull_request_number,
          project_id, unit_id, association_state, association_source, context_revision, target_branch,
          deliverable_ids, confirmed_by, confirmed_at)
       values ('local', 'docs', 'repo-1', 'pr-confirmed', 42, 'shop', 'web/core/invoice', 'confirmed',
               'maintainer', $1, 'main', '["code"]'::jsonb, $2, $3),
              ('local', 'docs', 'repo-1', 'pr-unconfirmed', 43, 'shop', 'web/core/invoice', 'needs_confirmation',
               null, null, null, '[]'::jsonb, null, null)`,
      [`sha256:${"4".repeat(64)}`, memberId, confirmedPrUpdatedAt],
    );

    const statusPath = withQuery("/member/v1/task-status", { projectId: "shop", unitId: "web/core/invoice" });
    const status = await client.request("GET", statusPath, { csrf: false, headers: bearer() });
    expect(status.status).toBe(200);
    expect(taskStatusSchema.parse(status.body.data)).toMatchObject({
      evidenceAvailability: { pullRequests: "available", reviews: "available" },
      pullRequests: [{
        repositoryId: "docs",
        pullRequestId: "pr-confirmed",
        state: "merged",
        headRevision: confirmedPrHead,
        updatedAt: confirmedPrUpdatedAt,
      }],
      currentReviewIds: [currentReviewId],
    });

    for (const state of [
      { status: "preparing", pinState: "pending", failureCode: null, code: "SNAPSHOT_PREPARING", httpStatus: 409 },
      { status: "failed", pinState: "failed", failureCode: "SNAPSHOT_PIN_FAILED", code: "SNAPSHOT_UNAVAILABLE", httpStatus: 409 },
      { status: "expiring", pinState: "releasing", failureCode: null, code: "SNAPSHOT_EXPIRED", httpStatus: 410 },
    ]) {
      await app.db.query(
        "update delivery.member_snapshot set status = $2, pin_state = $3, ready_at = null, failure_code = $4 where snapshot_id = $1",
        [brief.snapshotId, state.status, state.pinState, state.failureCode],
      );
      for (const path of [documentPath, searchPath]) {
        const unavailable = await client.request("GET", path, { csrf: false, headers: bearer() });
        expect(unavailable.status).toBe(state.httpStatus);
        expect(unavailable.body).toMatchObject({
          success: false,
          details: { code: state.code, snapshotId: brief.snapshotId, ...(state.status === "preparing" ? { retryAfterMs: 1000 } : {}) },
        });
      }
    }
  }, 60_000);

  it("serves the same project-scoped read use cases to the authenticated portal session", async () => {
    const portalSession = await adminClient(app);
    const tasks = await portalSession.get(withQuery("/member/v1/tasks", { projectId: "shop", limit: "25" }));
    expect(tasks.status).toBe(200);
    expect(taskListResultSchema.parse(tasks.body.data).items.map((task) => task.unitId)).toEqual(["web/core/invoice"]);

    const brief = await portalSession.get(withQuery("/member/v1/task-brief", {
      projectId: "shop", unitId: "web/core/invoice", activity: "implementation",
    }));
    expect(brief.status).toBe(200);
    expect(taskBriefSchema.parse(brief.body.data)).toMatchObject({
      projectId: "shop",
      unitId: "web/core/invoice",
      sections: expect.arrayContaining([expect.objectContaining({
        citation: expect.objectContaining({ path: expect.stringContaining("applications/web/units/core/invoice/task.md") }),
      })]),
    });

    const missingProjectScope = await portalSession.get("/member/v1/tasks");
    expect(missingProjectScope.status).toBe(403);
    const revokedScope = await portalSession.get(withQuery("/member/v1/tasks", { projectId: "not-granted" }));
    expect(revokedScope.status).toBe(403);
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

  it.each([
    { label: "overlong", reviewId: "x".repeat(513) },
    { label: "whitespace", reviewId: "   " },
  ])("returns 400 for an invalid $label review path ID", async ({ reviewId }) => {
    const response = await member().request("GET", withQuery("/member/v1/reviews/" + encodeURIComponent(reviewId), { projectId: "shop" }), { csrf: false, headers: bearer() });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, statusCode: 400 });
    expect(response.raw).not.toContain("Internal server error");
  });

  it("returns validated findings only inside the authorized project scope", async () => {
    const response = await member().request("GET", withQuery(`/member/v1/reviews/${currentReviewId}`, { projectId: "shop" }), { csrf: false, headers: bearer() });
    expect(response.status).toBe(200);
    expect(reviewReportSchema.parse(response.body.data)).toMatchObject({
      reviewId: currentReviewId,
      findings: [{ findingId: "finding-001", repairGuidance: "Use checked decimal arithmetic and add a boundary test." }],
    });

    const superseded = await member().request("GET", withQuery(`/member/v1/reviews/${supersededReviewId}`, { projectId: "shop" }), { csrf: false, headers: bearer() });
    expect(reviewReportSchema.parse(superseded.body.data).currentness).toBe("superseded");

    const queued = await member().request("GET", withQuery(`/member/v1/reviews/${queuedReviewId}`, { projectId: "shop" }), { csrf: false, headers: bearer() });
    expect(queued.status).toBe(409);
    expect(queued.body).toMatchObject({ success: false, details: { code: "REVIEW_NOT_READY", status: "queued" } });

    const failed = await member().request("GET", withQuery(`/member/v1/reviews/${failedReviewId}`, { projectId: "shop" }), { csrf: false, headers: bearer() });
    expect(failed.status).toBe(409);
    expect(failed.body).toMatchObject({ success: false, details: { code: "REVIEW_FAILED", status: "failed" } });

    const crossProject = await member().request("GET", withQuery(`/member/v1/reviews/${hiddenReviewId}`, { projectId: "shop" }), { csrf: false, headers: bearer() });
    expect(crossProject.status).toBe(404);
    expect(crossProject.raw).not.toContain("Invoice calculation can overflow");
  });
});
