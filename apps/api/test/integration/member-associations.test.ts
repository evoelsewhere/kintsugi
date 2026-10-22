import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";
import { hasDatabase } from "../support/database.js";

const projectId = "association-project";
const unitId = "billing-api/payments/invoice-validation";
const contextRevision = `sha256:${"a".repeat(64)}`;

describe.skipIf(!hasDatabase)("Coding Agent Workflow PR associations (integration)", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startTestApp();
    const actor = await app.db.query<{ id: string }>("select id from core.app_user where username = 'admin'");
    const actorId = actor.rows[0]!.id;
    await app.db.query("insert into admin.project (id, name) values ($1, 'Association project')", [projectId]);
    await app.db.query("insert into admin.application (project_id, id, name, disposition) values ($1, 'billing-api', 'Billing API', 'refactor')", [projectId]);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('association-docs-host', 'plain-git', 'Docs', 'https://docs.example', 'none')");
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('association-code-host', 'github', 'Code', 'https://github.com', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('association-docs-repo', 'association-docs-host', 'https://docs.example/project.git', 'main')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('association-code-repo', 'association-code-host', 'https://github.com/acme/billing.git', 'main')");
    await app.db.query("insert into admin.project_repository (project_id, repository_id, role) values ($1, 'association-docs-repo', 'document')", [projectId]);
    await app.db.query("insert into admin.project_repository (project_id, application_id, repository_id, role, component) values ($1, 'billing-api', 'association-code-repo', 'target', 'billing-api')", [projectId]);
    await app.db.query("insert into admin.project_access (project_id, user_id, granted_by) values ($1, $2, $2)", [projectId, actorId]);
    await app.db.query(
      `insert into delivery.member_task_projection
         (project_id, application_id, unit_id, repository_id, source_commit, source_path, source_hash,
          work_item, required_inputs, source_references, predecessor_gates)
       values ($1, 'billing-api', $2, 'association-docs-repo', $3, '10-applications/billing-api/02-modern/invoice/README.md', $4,
         $5::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
      [projectId, unitId, "b".repeat(40), "c".repeat(64), JSON.stringify({
        id: unitId,
        requiredDeliverables: [{ id: "invoice-api", repositoryId: "association-code-repo", path: "src/invoice.ts" }],
      })],
    );
    await app.db.query(
      `insert into delivery.member_snapshot
         (snapshot_id, project_id, unit_id, activity, requested_by_user_id, context_revision, task, readiness,
          manifest, status, pin_state, created_at, expires_at, ready_at)
       values ('ctx_11111111-1111-4111-8111-111111111111', $1, $2, 'implementation', $3, $4, $5::jsonb,
         '{}'::jsonb, $6::jsonb, 'ready', 'retained', clock_timestamp(), clock_timestamp() + interval '1 day', clock_timestamp())`,
      [projectId, unitId, actorId, contextRevision,
        JSON.stringify({ id: unitId, requiredDeliverables: [{ id: "invoice-api", repositoryId: "association-code-repo", path: "src/invoice.ts" }] }),
        JSON.stringify({ snapshotId: "ctx_11111111-1111-4111-8111-111111111111", projectId, unitId, requiredDeliverableIds: ["invoice-api"] })],
    );
    await app.db.query(
      `insert into workflow.member_provider_observation
         (server_id, repository_id, provider_repository_id, provider_pull_request_id, pull_request_number,
          state, author_provider_actor_id, head_sha, head_ref, base_sha, base_ref, provider_updated_at,
          association_claim_status, association_claim)
       values ('association-code-host', 'association-code-repo', '42', '87', 7, 'open', '9001', $1,
         'feature/invoice', $2, 'main', clock_timestamp(), 'valid', $3::jsonb)`,
      ["d".repeat(40), "e".repeat(40), JSON.stringify({ projectId, unitId, contextRevision, deliverableIds: ["invoice-api"] })],
    );
  }, 180_000);

  afterAll(async () => app?.close());

  it("lists unassociated provider PRs and confirms them against the pinned task context and deliverables", async () => {
    const admin = await adminClient(app);
    const pending = await admin.get<{ items: Array<{ providerPullRequestId: string; claim: unknown }> }>(
      `/member-associations/needs-confirmation?projectId=${projectId}`,
    );
    expect(pending.status).toBe(200);
    expect(pending.body.data?.items).toEqual([
      expect.objectContaining({ providerPullRequestId: "87", claim: { projectId, unitId, contextRevision, deliverableIds: ["invoice-api"] } }),
    ]);

    const confirmed = await admin.request<{ association: { state: string; source: string } }>(
      "POST",
      "/member-associations/association-code-host/42/87/confirm",
      { body: { projectId, unitId, contextRevision, deliverableIds: ["invoice-api"] } },
    );
    expect(confirmed.status, confirmed.raw).toBe(201);
    expect(confirmed.body.data?.association).toEqual({ state: "confirmed", source: "maintainer" });

    const row = await app.db.query<{ repository_id: string; association_state: string; association_source: string; context_revision: string }>(
      `select repository_id, association_state, association_source, context_revision
         from workflow.member_task_pull_request where provider_pull_request_id = '87'`,
    );
    expect(row.rows[0]).toEqual({ repository_id: "association-code-repo", association_state: "confirmed", association_source: "maintainer", context_revision: contextRevision });

    // The project task projection is a mutable index rebuilt wholesale when its
    // document repository advances. Historical PR association must survive that refresh.
    await app.db.query("delete from delivery.member_task_projection where project_id = $1", [projectId]);
    await app.db.query(
      `insert into delivery.member_task_projection
         (project_id, application_id, unit_id, repository_id, source_commit, source_path, source_hash,
          work_item, required_inputs, source_references, predecessor_gates)
       values ($1, 'billing-api', $2, 'association-docs-repo', $3, '10-applications/billing-api/02-modern/invoice/README.md', $4,
         $5::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
      [projectId, unitId, "f".repeat(40), "d".repeat(64), JSON.stringify({
        id: unitId,
        requiredDeliverables: [{ id: "invoice-api", repositoryId: "association-code-repo", path: "src/invoice.ts" }],
      })],
    );
    const afterProjectionRefresh = await app.db.query<{ association_state: string; context_revision: string }>(
      "select association_state, context_revision from workflow.member_task_pull_request where provider_pull_request_id = '87'",
    );
    expect(afterProjectionRefresh.rows[0]).toEqual({ association_state: "confirmed", context_revision: contextRevision });

    const secondContext = `sha256:${"b".repeat(64)}`;
    await app.db.query(
      `insert into delivery.member_snapshot
         (snapshot_id, project_id, unit_id, activity, requested_by_user_id, context_revision, task, readiness,
          manifest, status, pin_state, created_at, expires_at, ready_at)
       values ('ctx_22222222-2222-4222-8222-222222222222', $1, $2, 'implementation', $3, $4, $5::jsonb,
         '{}'::jsonb, $6::jsonb, 'ready', 'retained', clock_timestamp(), clock_timestamp() + interval '1 day', clock_timestamp())`,
      [projectId, unitId, row.rows[0]!.repository_id, secondContext,
        JSON.stringify({ id: unitId, requiredDeliverables: [{ id: "invoice-api", repositoryId: "association-code-repo", path: "src/invoice.ts" }] }),
        JSON.stringify({ snapshotId: "ctx_22222222-2222-4222-8222-222222222222", projectId, unitId, requiredDeliverableIds: ["invoice-api"] })],
    );
    const reassignment = await admin.request("POST", "/member-associations/association-code-host/42/87/confirm", {
      body: { projectId, unitId, contextRevision: secondContext, deliverableIds: ["invoice-api"] },
    });
    expect(reassignment.status, reassignment.raw).toBe(409);
    const afterReassignment = await app.db.query<{ context_revision: string }>(
      "select context_revision from workflow.member_task_pull_request where provider_pull_request_id = '87'",
    );
    expect(afterReassignment.rows[0]?.context_revision).toBe(contextRevision);
  });

  it("rejects a PR whose target branch is not the repository default branch", async () => {
    const admin = await adminClient(app);
    await app.db.query("update workflow.member_provider_observation set base_ref = 'release' where provider_pull_request_id = '87'");
    const response = await admin.request("POST", "/member-associations/association-code-host/42/87/confirm", {
      body: { projectId, unitId, contextRevision, deliverableIds: ["invoice-api"] },
    });
    expect(response.status, response.raw).toBe(409);
    expect(response.body.data).toBeUndefined();
  });

  it("maps only authorized project contributors to stable provider actor IDs and schedules reconciliation", async () => {
    const admin = await adminClient(app);
    const { id: contributorId } = await memberClient(app, admin, "association-contributor", ["user"]);
    const { id: otherContributorId } = await memberClient(app, admin, "association-other-contributor", ["user"]);

    const unauthorized = await admin.request("PUT", `/member-associations/${projectId}/actors/association-code-host/9002`, {
      body: { userId: otherContributorId },
    });
    expect(unauthorized.status, unauthorized.raw).toBe(404);

    await app.db.query("insert into admin.project_access (project_id, user_id, granted_by) values ($1, $2, $3)", [projectId, contributorId, contributorId]);

    const created = await admin.request("PUT", `/member-associations/${projectId}/actors/association-code-host/9001`, {
      body: { userId: contributorId },
    });
    expect(created.status, created.raw).toBe(204);
    const repeated = await admin.request("PUT", `/member-associations/${projectId}/actors/association-code-host/9001`, {
      body: { userId: contributorId },
    });
    expect(repeated.status, repeated.raw).toBe(204);

    await app.db.query("insert into admin.project_access (project_id, user_id, granted_by) values ($1, $2, $3)", [projectId, otherContributorId, otherContributorId]);
    const conflict = await admin.request("PUT", `/member-associations/${projectId}/actors/association-code-host/9001`, {
      body: { userId: otherContributorId },
    });
    expect(conflict.status, conflict.raw).toBe(409);

    const mapping = await app.db.query<{ user_id: string; confirmed_by: string }>(
      `select user_id, confirmed_by from workflow.member_provider_actor_mapping
        where project_id = $1 and server_id = 'association-code-host' and provider_actor_id = '9001'`,
      [projectId],
    );
    expect(mapping.rows[0]).toEqual({ user_id: contributorId, confirmed_by: (await app.db.query<{ id: string }>("select id from core.app_user where username = 'admin'")).rows[0]!.id });
    const watermark = await app.db.query<{ next_poll_at: Date }>(
      "select next_poll_at from workflow.member_provider_sync_watermark where repository_id = 'association-code-repo'",
    );
    expect(watermark.rows).toHaveLength(1);
    expect(watermark.rows[0]!.next_poll_at.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("paginates association-needed PRs without repeating the first page", async () => {
    await app.db.query(
      `insert into workflow.member_provider_observation
         (server_id, repository_id, provider_repository_id, provider_pull_request_id, pull_request_number,
          state, author_provider_actor_id, head_sha, head_ref, base_sha, base_ref, provider_updated_at)
       values ('association-code-host', 'association-code-repo', '42', '88', 8, 'open', '9002', $1,
          'feature/eight', $2, 'main', clock_timestamp()),
              ('association-code-host', 'association-code-repo', '42', '89', 9, 'open', '9003', $3,
          'feature/nine', $4, 'main', clock_timestamp())`,
      ["f".repeat(40), "1".repeat(40), "2".repeat(40), "3".repeat(40)],
    );
    const admin = await adminClient(app);
    const first = await admin.get<{ items: Array<{ providerPullRequestId: string }>; hasMore: boolean }>(
      `/member-associations/needs-confirmation?projectId=${projectId}&limit=1&offset=0`,
    );
    const second = await admin.get<{ items: Array<{ providerPullRequestId: string }>; hasMore: boolean }>(
      `/member-associations/needs-confirmation?projectId=${projectId}&limit=1&offset=1`,
    );
    expect(first.status, first.raw).toBe(200);
    expect(second.status, second.raw).toBe(200);
    expect(first.body.data?.items).toHaveLength(1);
    expect(second.body.data?.items).toHaveLength(1);
    expect(first.body.data?.items[0]?.providerPullRequestId).not.toBe(second.body.data?.items[0]?.providerPullRequestId);
    expect(first.body.data?.hasMore).toBe(true);
    expect(second.body.data?.hasMore).toBe(false);
  });

  it("requires current Project Access before listing or confirming project associations", async () => {
    const admin = await adminClient(app);
    const actor = await app.db.query<{ id: string }>("select id from core.app_user where username = 'admin'");
    const actorId = actor.rows[0]!.id;
    await app.db.query("delete from admin.project_access where project_id = $1 and user_id = $2", [projectId, actorId]);

    try {
      const pending = await admin.get(`/member-associations/needs-confirmation?projectId=${projectId}`);
      expect(pending.status, pending.raw).toBe(403);

      const confirmation = await admin.request("POST", "/member-associations/association-code-host/42/87/confirm", {
        body: { projectId, unitId, contextRevision, deliverableIds: ["invoice-api"] },
      });
      expect(confirmation.status, confirmation.raw).toBe(403);
      expect(confirmation.body.data).toBeUndefined();
    } finally {
      await app.db.query("insert into admin.project_access (project_id, user_id, granted_by) values ($1, $2, $2) on conflict do nothing", [projectId, actorId]);
    }
  });
});
