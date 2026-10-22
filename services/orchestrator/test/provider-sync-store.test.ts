import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ObservedPullRequest } from "@kintsugi/git";
import { PostgresProviderSyncStore } from "../src/provider-sync/inbox.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

describe.skipIf(!hasDatabase)("Postgres provider sync inbox (integration)", () => {
  let db: TestDatabase;
  let store: PostgresProviderSyncStore;

  beforeAll(async () => {
    db = await createTestDatabase();
    store = new PostgresProviderSyncStore(db.pool);
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('provider-sync', 'github', 'Provider sync', 'https://github.com', 'none')");
    await db.pool.query("insert into admin.git_repository (id, server_id, url) values ('provider-sync-repo', 'provider-sync', 'https://github.com/Acme/Provider-sync.git')");
  });

  afterAll(async () => db?.drop());

  it("holds one repository lease, resumes a saved cursor and acknowledges only the captured receipt snapshot", async () => {
    const initial = await store.watermark("provider-sync-repo");
    expect(initial.updatedAtWatermark).toBe("1970-01-01T00:00:00.000Z");
    let secondLease = true;
    const firstLease = await store.withRepositoryLock("provider-sync-repo", async () => {
      secondLease = await store.withRepositoryLock("provider-sync-repo", async () => undefined);
    });
    expect(firstLease).toBe(true);
    expect(secondLease).toBe(false);

    await db.pool.query(
      `insert into workflow.member_provider_delivery
         (server_id, delivery_id, event_name, repository_id, pull_request_number, payload, payload_sha256)
       values ('provider-sync', 'delivery-one', 'pull_request', 'provider-sync-repo',
               7, '{"providerRepositoryId":"42","providerPullRequestId":"87","repositoryPath":"Acme/Provider-sync","pullRequestNumber":7}', $1)`,
      ["a".repeat(64)],
    );
    expect(await store.deliveries("provider-sync-repo")).toEqual([{
      deliveryId: "delivery-one",
      providerRepositoryId: "42",
      providerPullRequestId: "87",
      pullRequestNumber: 7,
    }]);
    expect(await store.repositoriesToSync(20)).toContain("provider-sync-repo");
    await store.saveProgress("provider-sync-repo", {
      sweepMode: "deep",
      cursor: "https://api.github.com/repos/Acme/Provider-sync/pulls?state=all&page=2",
      startedAt: "2026-10-21T10:00:00.000Z",
      deepBackfillStartedAt: "2026-10-21T10:00:00.000Z",
    });
    expect(await store.watermark("provider-sync-repo")).toMatchObject({
      updatedAtWatermark: "1970-01-01T00:00:00.000Z",
      sweepMode: "deep",
      cursor: "https://api.github.com/repos/Acme/Provider-sync/pulls?state=all&page=2",
    });

    await db.pool.query(
      `insert into workflow.member_provider_delivery
         (server_id, delivery_id, event_name, repository_id, payload, payload_sha256)
       values ('provider-sync', 'delivery-two', 'pull_request', 'provider-sync-repo', '{"providerRepositoryId":"42"}', $1)`,
      ["b".repeat(64)],
    );
    await store.acknowledgeDeliveries("provider-sync-repo", ["delivery-one"]);
    await store.completeSweep("provider-sync-repo", {
      updatedAtWatermark: "2026-10-21T10:10:00.000Z",
      providerRepositoryId: "42",
      completedAt: "2026-10-21T10:15:00.000Z",
      lastDeepBackfillAt: "2026-10-21T10:15:00.000Z",
      nextPollAt: "2026-10-21T10:17:00.000Z",
      deliveryIds: [],
    });
    const deliveries = await db.pool.query<{ delivery_id: string; state: string }>(
      "select delivery_id, state from workflow.member_provider_delivery order by delivery_id",
    );
    expect(deliveries.rows).toEqual([
      { delivery_id: "delivery-one", state: "processed" },
      { delivery_id: "delivery-two", state: "pending" },
    ]);
    expect(await store.repositoriesToSync(20)).toContain("provider-sync-repo");
    const completed = await store.watermark("provider-sync-repo");
    expect(completed).toMatchObject({
      updatedAtWatermark: "2026-10-21T10:10:00.000Z",
      consecutiveFailures: 0,
    });
    expect(completed).not.toHaveProperty("cursor");
    expect(completed).not.toHaveProperty("sweepMode");
  });

  it("records a bounded failure and leaves a retryable receipt without advancing the completed watermark", async () => {
    await db.pool.query("insert into admin.git_repository (id, server_id, url) values ('provider-sync-retry', 'provider-sync', 'https://github.com/Acme/Provider-sync-retry.git')");
    await store.watermark("provider-sync-retry");
    await db.pool.query(
      `insert into workflow.member_provider_delivery
         (server_id, delivery_id, event_name, repository_id, payload, payload_sha256)
       values ('provider-sync', 'delivery-retry', 'pull_request', 'provider-sync-retry', '{}', $1)`,
      ["c".repeat(64)],
    );
    await store.failDeliveries("provider-sync-retry", ["delivery-retry"], "GITHUB_HTTP_429");
    await store.recordFailure("provider-sync-retry", {
      errorCode: "GITHUB_HTTP_429",
      nextPollAt: "2099-01-01T00:00:00.000Z",
    });

    const delivery = await db.pool.query<{ state: string; attempt_count: number; last_error: string }>(
      "select state, attempt_count, last_error from workflow.member_provider_delivery where delivery_id = 'delivery-retry'",
    );
    expect(delivery.rows[0]).toEqual({ state: "failed", attempt_count: 1, last_error: "GITHUB_HTTP_429" });
    expect(await store.watermark("provider-sync-retry")).toMatchObject({
      updatedAtWatermark: "1970-01-01T00:00:00.000Z",
      consecutiveFailures: 1,
    });
    expect(await store.repositoriesToSync(20)).not.toContain("provider-sync-retry");
  });

  it("persists current provider observations idempotently and rejects a stale overlap update", async () => {
    const current: ObservedPullRequest = {
      provider: "github",
      host: "github.com",
      repositoryId: "42",
      repositoryPath: "Acme/Provider-sync",
      pullRequestId: "87",
      number: 7,
      htmlUrl: "https://github.com/Acme/Provider-sync/pull/7",
      authorId: "9",
      authorLogin: "contributor",
      associationClaimStatus: "valid",
      associationClaim: {
        projectId: "provider-sync-project",
        unitId: "billing-api/payments/invoice-validation",
        contextRevision: `sha256:${"a".repeat(64)}`,
        deliverableIds: ["invoice-api"],
      },
      state: "open",
      draft: false,
      updatedAt: "2026-10-21T10:10:00.000Z",
      headSha: "a".repeat(40),
      headRef: "feature/change",
      baseSha: "b".repeat(40),
      baseRef: "main",
      reviews: [],
      checks: [],
    };
    await store.persistObservation("provider-sync-repo", current);
    await store.persistObservation("provider-sync-repo", { ...current, updatedAt: "2026-10-21T10:20:00.000Z", headSha: "c".repeat(40) });
    await store.persistObservation("provider-sync-repo", { ...current, updatedAt: "2026-10-21T10:15:00.000Z", headSha: "d".repeat(40) });

    const row = await db.pool.query<{ head_sha: string; provider_updated_at: Date; association_claim_status: string; association_claim: Record<string, unknown> }>(
      `select head_sha, provider_updated_at, association_claim_status, association_claim from workflow.member_provider_observation
        where repository_id = 'provider-sync-repo' and provider_pull_request_id = '87'`,
    );
    expect(row.rows[0]?.head_sha).toBe("c".repeat(40));
    expect(row.rows[0]?.provider_updated_at.toISOString()).toBe("2026-10-21T10:20:00.000Z");
    expect(row.rows[0]?.association_claim_status).toBe("valid");
    expect(row.rows[0]?.association_claim).toEqual({
      projectId: "provider-sync-project",
      unitId: "billing-api/payments/invoice-validation",
      contextRevision: `sha256:${"a".repeat(64)}`,
      deliverableIds: ["invoice-api"],
    });
  });

  it("keeps unknown authors pending, promotes only a verified project actor, and never reassigns a confirmed PR from an edited claim", async () => {
    const projectId = "provider-association-project";
    const unitId = "billing-api/payments/invoice-validation";
    const alternateUnitId = "billing-api/payments/refund-validation";
    const contextRevision = `sha256:${"a".repeat(64)}`;
    const alternateContextRevision = `sha256:${"b".repeat(64)}`;
    await db.pool.query("update admin.git_repository set default_branch = 'main' where id = 'provider-sync-repo'");
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('provider-association-docs-host', 'plain-git', 'Docs', 'https://docs.example', 'none')");
    await db.pool.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('provider-association-docs-repo', 'provider-association-docs-host', 'https://docs.example/project.git', 'main')");
    await db.pool.query("insert into admin.project (id, name) values ($1, 'Provider association project')", [projectId]);
    await db.pool.query("insert into admin.application (project_id, id, name) values ($1, 'billing-api', 'Billing API')", [projectId]);
    await db.pool.query("insert into admin.project_repository (project_id, repository_id, role) values ($1, 'provider-association-docs-repo', 'document')", [projectId]);
    await db.pool.query("insert into admin.project_repository (project_id, application_id, repository_id, role, component) values ($1, 'billing-api', 'provider-sync-repo', 'target', 'billing-api')", [projectId]);
    await db.pool.query("insert into core.app_user (id, username, password_hash, password_salt) values ('association-user', 'association-user', 'test-hash', 'test-salt')");
    await db.pool.query("insert into admin.project_access (project_id, user_id, granted_by) values ($1, 'association-user', 'association-user')", [projectId]);

    const workItem = (id: string, deliverableId: string) => ({
      id,
      requiredDeliverables: [{ id: deliverableId, repositoryId: "provider-sync-repo", path: "src/feature.ts" }],
    });
    const seedTaskAndSnapshot = async (unit: string, context: string, deliverable: string, suffix: string) => {
      await db.pool.query(
        `insert into delivery.member_task_projection
           (project_id, application_id, unit_id, repository_id, source_commit, source_path, source_hash,
            work_item, required_inputs, source_references, predecessor_gates)
         values ($1, 'billing-api', $2, 'provider-association-docs-repo', $3, 'task.md', $4, $5::jsonb,
           '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
        [projectId, unit, "c".repeat(40), "d".repeat(64), JSON.stringify(workItem(unit, deliverable))],
      );
      await db.pool.query(
        `insert into delivery.member_snapshot
           (snapshot_id, project_id, unit_id, activity, requested_by_user_id, context_revision, task, readiness,
            manifest, status, pin_state, created_at, expires_at, ready_at)
         values ($1, $2, $3, 'implementation', 'association-user', $4, $5::jsonb, '{}'::jsonb, $6::jsonb,
           'ready', 'retained', clock_timestamp(), clock_timestamp() + interval '1 day', clock_timestamp())`,
        [`ctx_${suffix}`, projectId, unit, context, JSON.stringify(workItem(unit, deliverable)), JSON.stringify({ projectId, unitId: unit, requiredDeliverableIds: [deliverable] })],
      );
    };
    await seedTaskAndSnapshot(unitId, contextRevision, "invoice-api", "33333333-3333-4333-8333-333333333333");
    await seedTaskAndSnapshot(alternateUnitId, alternateContextRevision, "refund-api", "44444444-4444-4444-8444-444444444444");

    const current: ObservedPullRequest = {
      provider: "github", host: "github.com", repositoryId: "42", repositoryPath: "Acme/Provider-sync",
      pullRequestId: "association-pr-87", number: 87, htmlUrl: "https://github.com/Acme/Provider-sync/pull/87",
      authorId: "9", authorLogin: "mapped-later", associationClaimStatus: "valid",
      associationClaim: { projectId, unitId, contextRevision, deliverableIds: ["invoice-api"] },
      state: "open", draft: false, updatedAt: "2026-10-21T10:30:00.000Z", headSha: "a".repeat(40),
      headRef: "feature/invoice", baseSha: "b".repeat(40), baseRef: "main", reviews: [], checks: [],
    };
    await store.persistObservation("provider-sync-repo", current);
    const pending = await db.pool.query<{ association_state: string; association_source: string | null }>(
      `select association_state, association_source from workflow.member_task_pull_request
        where provider_pull_request_id = 'association-pr-87'`,
    );
    expect(pending.rows[0]).toEqual({ association_state: "needs_confirmation", association_source: null });

    await db.pool.query(
      `insert into workflow.member_provider_actor_mapping (project_id, server_id, provider_actor_id, user_id, confirmed_by)
       values ($1, 'provider-sync', '9', 'association-user', 'association-user')`,
      [projectId],
    );
    await store.reconcileAssociations("provider-sync-repo");
    const confirmed = await db.pool.query<{ project_id: string; unit_id: string; association_state: string; association_source: string; verified_actor_id: string; context_revision: string }>(
      `select project_id, unit_id, association_state, association_source, verified_actor_id, context_revision
         from workflow.member_task_pull_request where provider_pull_request_id = 'association-pr-87'`,
    );
    expect(confirmed.rows[0]).toEqual({
      project_id: projectId, unit_id: unitId, association_state: "confirmed", association_source: "verified_actor",
      verified_actor_id: "9", context_revision: contextRevision,
    });

    await db.pool.query("delete from admin.project_access where project_id = $1 and user_id = 'association-user'", [projectId]);
    const retained = await db.pool.query<{ association_state: string; verified_actor_id: string }>(
      `select association_state, verified_actor_id from workflow.member_task_pull_request
        where provider_pull_request_id = 'association-pr-87'`,
    );
    expect(retained.rows[0]).toEqual({ association_state: "confirmed", verified_actor_id: "9" });

    await store.persistObservation("provider-sync-repo", {
      ...current,
      updatedAt: "2026-10-21T10:32:00.000Z",
      associationClaim: { projectId, unitId: alternateUnitId, contextRevision: alternateContextRevision, deliverableIds: ["refund-api"] },
    });
    const afterBodyEdit = await db.pool.query<{ unit_id: string; context_revision: string }>(
      `select unit_id, context_revision from workflow.member_task_pull_request where provider_pull_request_id = 'association-pr-87'`,
    );
    expect(afterBodyEdit.rows[0]).toEqual({ unit_id: unitId, context_revision: contextRevision });
  });
});
